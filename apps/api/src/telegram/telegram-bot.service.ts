import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AttendanceLocationInput } from '@workforce/contracts';
import { AttendanceService } from '../attendance/attendance.service.js';
import { formatSiteDateTime, getSiteDate } from '../attendance/schedule-evaluator.js';
import type { WorkerPrincipal } from '../auth/principal.js';
import { TelegramNotifierService } from '../jobs/telegram-notifier.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizePhone } from '../common/phone.util.js';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private isPolling = false;
  private lastUpdateId = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly configService: ConfigService,
  ) {}

  private get webAppUrl(): string {
    return (
      this.configService.get<string>('TELEGRAM_MINI_APP_URL') ??
      process.env.TELEGRAM_MINI_APP_URL ??
      'https://squander-ferry-armless.ngrok-free.dev'
    );
  }

  async onModuleInit(): Promise<void> {
    const token =
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured; Telegram polling disabled.');
      return;
    }

    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_TELEGRAM_POLLING === 'true') {
      return;
    }

    this.startLongPolling(token);
  }

  onModuleDestroy(): void {
    this.isPolling = false;
  }

  private async startLongPolling(token: string): Promise<void> {
    this.isPolling = true;
    this.logger.log('Starting Telegram long-polling runner for @site_attendantbot...');

    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    } catch {
      // ignore
    }

    void (async () => {
      while (this.isPolling) {
        try {
          const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=15`;
          const res = await fetch(url);
          const data = (await res.json()) as any;

          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
              try {
                await this.handleUpdate(update);
              } catch (updateErr: any) {
                this.logger.error(
                  `Error handling Telegram update ${update.update_id}: ${updateErr.message}`,
                );
              }
            }
          } else if (!data.ok) {
            await new Promise((r) => setTimeout(r, 3000));
          }
        } catch {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
  }

  /**
   * Main entrypoint for incoming Telegram webhook updates.
   */
  async handleUpdate(update: any): Promise<void> {
    if (!update || typeof update !== 'object') return;

    // Handle inline button callback query
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = String(cb.message?.chat?.id || cb.from.id);
      if (cb.data === 'register_phone') {
        await this.handleUnlinkedUser(chatId, cb.from);
      }
      await this.answerCallbackQuery(cb.id);
      return;
    }

    const message = update.message || update.edited_message;
    if (!message || !message.from || !message.chat) return;

    const telegramUserId = String(message.from.id);
    const chatId = String(message.chat.id);
    const text = (message.text || '').trim();
    const location = message.location;
    const contact = message.contact;

    this.logger.log(
      `Telegram update from user=${telegramUserId} (${message.from.first_name || 'unknown'}), text="${text}", hasLocation=${!!location}, hasContact=${!!contact}`,
    );

    // 1. Handle contact sharing for instant worker registration / authorization
    if (contact) {
      await this.handleContactRegistration(chatId, message.from, contact);
      return;
    }

    // 2. Resolve linked Telegram account
    const account = await this.prisma.telegramAccount.findUnique({
      where: { telegramUserId },
      include: {
        employee: true,
        organization: true,
      },
    });

    if (!account || account.status !== 'ACTIVE') {
      await this.handleUnlinkedUser(chatId, message.from);
      return;
    }

    // 3. Handle native GPS location message
    if (location) {
      await this.handleLocationAttendance(chatId, account, location, message.message_id, message.date);
      return;
    }

    // 4. Handle commands & button taps for authorized workers
    const textLower = text.toLowerCase();
    if (text.startsWith('/start')) {
      await this.handleStartCommand(chatId, account);
    } else if (text === '/checkin' || textLower.includes('check in') || textLower.includes('checkin')) {
      await this.promptLocationCheckIn(chatId, account);
    } else if (text === '/checkout' || textLower.includes('check out') || textLower.includes('checkout')) {
      await this.promptLocationCheckOut(chatId, account);
    } else if (text === '/status' || textLower.includes('status')) {
      await this.handleStatusCommand(chatId, account);
    } else if (text === '/help' || textLower.includes('help')) {
      await this.handleHelpCommand(chatId);
    } else {
      // Default: show main keyboard menu
      await this.sendMainMenu(
        chatId,
        `👋 Hello, *${account.employee.fullName}*! Choose an option below to record attendance or check your status:`,
      );
    }
  }

  /**
   * Handles contact sharing: verifies phone number, matches existing employee or auto-registers new worker.
   */
  async handleContactRegistration(
    chatId: string,
    from: any,
    contact: { phone_number: string; user_id?: number; first_name?: string; last_name?: string },
  ): Promise<void> {
    const telegramUserId = String(from.id);

    // Security check: Ensure user shared their own phone number
    if (contact.user_id && String(contact.user_id) !== telegramUserId) {
      await this.telegramNotifier.sendMessage(
        chatId,
        `⚠️ *Verification Failed*\nYou must tap the button to share your own phone number, not a forwarded contact card.`,
        'Markdown',
      );
      return;
    }

    const rawPhone = contact.phone_number || '';
    const normPhone = normalizePhone(rawPhone);
    const digits = rawPhone.replace(/\D/g, '');

    if (!normPhone && digits.length < 6) {
      await this.telegramNotifier.sendMessage(
        chatId,
        `⚠️ Invalid phone number received. Please try again.`,
        'Markdown',
      );
      return;
    }

    // 1. Check if already linked
    const existingAccount = await this.prisma.telegramAccount.findUnique({
      where: { telegramUserId },
      include: { employee: true, organization: true },
    });

    if (existingAccount) {
      if (!existingAccount.employee.normalizedPhone && normPhone) {
        await this.prisma.employee.update({
          where: { id: existingAccount.employee.id },
          data: { normalizedPhone: normPhone },
        });
      }

      await this.sendMainMenu(
        chatId,
        `✅ *Already Registered & Authorized!*\n\nWelcome back, *${existingAccount.employee.fullName}* (\`${existingAccount.employee.employeeCode}\`). Your account is authorized under *${existingAccount.organization.name}*.\n\nTap *📍 Check In* below to record your site attendance!`,
      );
      return;
    }

    // 2. Search for existing employee pre-created by HR matching normalized E.164 phone number
    let matchedEmployees = await this.prisma.employee.findMany({
      where: {
        normalizedPhone: normPhone,
        status: 'ACTIVE',
      },
      include: { telegramAccount: true, organization: true },
    });

    // Fallback search for legacy records where normalizedPhone was not set at creation time
    if (matchedEmployees.length === 0 && digits.length >= 6) {
      const allActive = await this.prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        include: { telegramAccount: true, organization: true },
      });
      matchedEmployees = allActive.filter((emp) => {
        if (!emp.phone) return false;
        const empNorm = normalizePhone(emp.phone);
        if (empNorm && normPhone) return empNorm === normPhone;
        const empDigits = emp.phone.replace(/\D/g, '');
        return empDigits === digits;
      });
    }

    // Strict Amendment 3 Requirement: Match strictly ONE active employee.
    // Zero or duplicate matches MUST NOT auto-create or auto-link a worker.
    if (matchedEmployees.length !== 1) {
      const org = await this.prisma.organization.findFirst();
      const orgId = org?.id;

      if (orgId) {
        let existingReq = await this.prisma.registrationRequest.findFirst({
          where: { telegramUserId, status: 'PENDING' },
        });

        if (!existingReq) {
          await this.prisma.registrationRequest.create({
            data: {
              organizationId: orgId,
              telegramUserId,
              phone: rawPhone,
              normalizedPhone: normPhone || rawPhone,
              telegramUsername: from.username || null,
              telegramFirstName: from.first_name || null,
              telegramLastName: from.last_name || null,
              telegramPhotoUrl: from.photo_url || null,
              status: 'PENDING',
            },
          });
        }
      }

      await this.telegramNotifier.sendMessage(
        chatId,
        `⏳ *Registration Submitted & Pending Review*\n\nYour account is under review by the admin site or your manager. Once your request is reviewed and approved, you will be notified here automatically!`,
        'Markdown',
      );
      return;
    }

    const matchedEmployee = matchedEmployees[0];
    const orgId = matchedEmployee.organizationId;

    if (matchedEmployee.telegramAccount) {
      await this.prisma.telegramAccount.update({
        where: { id: matchedEmployee.telegramAccount.id },
        data: {
          telegramUserId,
          username: from.username || null,
          firstName: from.first_name || null,
          lastName: from.last_name || null,
          lastVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });
    } else {
      await this.prisma.telegramAccount.create({
        data: {
          organizationId: orgId,
          employeeId: matchedEmployee.id,
          telegramUserId,
          username: from.username || null,
          firstName: from.first_name || null,
          lastName: from.last_name || null,
          lastVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
      });
    }

    if (!matchedEmployee.normalizedPhone && normPhone) {
      await this.prisma.employee.update({
        where: { id: matchedEmployee.id },
        data: { normalizedPhone: normPhone },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        organizationId: orgId,
        action: 'TELEGRAM_ACCOUNT_LINKED_VIA_PHONE',
        targetType: 'TelegramAccount',
        targetId: telegramUserId,
        metadata: {
          phone: rawPhone,
          normalizedPhone: normPhone,
          employeeId: matchedEmployee.id,
          employeeCode: matchedEmployee.employeeCode,
        },
      },
    });

    const successLines = [
      `🎉 *Phone Number Verified & Authorized!*`,
      '',
      `Welcome, *${matchedEmployee.fullName}*!`,
      `• *Employee Code:* \`${matchedEmployee.employeeCode}\``,
      `• *Organization:* *${matchedEmployee.organization.name}*`,
      '',
      `Your account has been authorized. You can now check in with GPS using the menu below!`,
    ];

    await this.sendMainMenu(chatId, successLines.join('\n'));
  }

  /**
   * Prompts unlinked Telegram user to share their phone number to register.
   */
  private async handleUnlinkedUser(chatId: string, from: any): Promise<void> {
    const text = [
      `👋 Hello *${from.first_name || 'there'}*!`,
      '',
      `Welcome to the *Workforce Site Attendance* system.`,
      '',
      `📱 *Worker Registration & Access Authorization:*`,
      `Please tap the button below to share your phone number. Your account will be verified and authorized immediately so you can start recording attendance.`,
    ].join('\n');

    const replyMarkup = {
      keyboard: [
        [{ text: '📱 Share Phone Number to Register', request_contact: true }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    };

    await this.telegramNotifier.sendMessage(chatId, text, 'Markdown', replyMarkup);
  }

  /**
   * /start command: greets worker and sends persistent reply keyboard.
   */
  private async handleStartCommand(chatId: string, account: any): Promise<void> {
    const text = [
      `👋 Welcome, *${account.employee.fullName}*!`,
      `• *Employee Code:* \`${account.employee.employeeCode}\``,
      `• *Organization:* *${account.organization.name}*`,
      '',
      `Tap *Open Attendance* below to submit your GPS attendance.`,
    ].join('\n');

    await this.sendMainMenu(chatId, text);
  }

  /**
   * Check-in must use the Mini App so photo capture and GPS evidence stay together.
   */
  private async promptLocationCheckIn(chatId: string, account: any): Promise<void> {
    const text = [
      `📷 *Open Attendance to Check In*`,
      `Worker: *${account.employee.fullName}*`,
      '',
      `Tap *Open Attendance* below. The Mini App will collect GPS only when you submit your check-in.`,
    ].join('\n');
    await this.sendMainMenu(chatId, text);
  }

  /** Check-out also uses the Mini App so the worker sees the confirmed result. */
  private async promptLocationCheckOut(chatId: string, account: any): Promise<void> {
    const text = [
      `🏁 *Check-Out Requested*`,
      `Worker: *${account.employee.fullName}*`,
      '',
      `Tap *Open Attendance* below to submit your current GPS location and close your shift.`,
    ].join('\n');
    await this.sendMainMenu(chatId, text);
  }

  /**
   * Handles incoming native GPS location evidence.
   */
  private async handleLocationAttendance(
    chatId: string,
    account: any,
    location: { latitude: number; longitude: number; horizontal_accuracy?: number },
    messageId: number,
    timestampSeconds?: number,
  ): Promise<void> {
    const principal: WorkerPrincipal = {
      type: 'worker',
      organizationId: account.organizationId,
      employeeId: account.employeeId,
      telegramUserId: account.telegramUserId,
      sessionId: `tg-bot-${account.telegramUserId}`,
    };

    const locationInput: AttendanceLocationInput = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: location.horizontal_accuracy || 15,
      capturedAt: timestampSeconds
        ? new Date(timestampSeconds * 1000).toISOString()
        : new Date().toISOString(),
      deviceContext: {
        platform: 'telegram-native',
        appVersion: 'bot-v1',
      },
    };

    const idempotencyKey = `tg-msg-${messageId}`;

    try {
      // 1. Get current today state to determine intent (Check-in vs Check-out)
      const todayData = await this.attendanceService.getWorkerToday(principal);
      const att = todayData.attendance;

      const isCheckedIn = att && att.checkInAt !== null;
      const isCheckedOut = att && att.checkOutAt !== null;

      if (isCheckedIn && isCheckedOut) {
        const text = [
          `ℹ️ *Shift Already Completed Today*`,
          `You have already checked in and checked out for today at *${todayData.site.name}*.`,
          `• Total duration: *${Math.floor((att.workDurationMinutes || 0) / 60)}h ${(att.workDurationMinutes || 0) % 60}m*`,
          `If you need an adjustment, contact your supervisor to submit a correction.`,
        ].join('\n');
        await this.sendMainMenu(chatId, text);
        return;
      }

      if (!isCheckedIn) {
        // Perform CHECK-IN
        const result = await this.attendanceService.checkIn(
          principal,
          locationInput,
          idempotencyKey,
        );

        const isVerified = result.verificationResult === 'VERIFIED';
        const isOutside = result.verificationResult === 'OUTSIDE_GEOFENCE';
        const formattedTime = formatSiteDateTime(new Date(result.timestamp), todayData.siteTimezone);

        const replyLines = [
          isVerified
            ? `✅ *Check-In Verified & Recorded!*`
            : isOutside
            ? `⛔ *Check-In Warning: Outside Geofence Zone!*`
            : `⚠️ *Check-In Recorded with Warning*`,
          '',
          `👤 *Worker:* ${account.employee.fullName} (\`${account.employee.employeeCode}\`)`,
          `🏢 *Site:* *${todayData.site.name}*`,
          `📊 *Status:* *${result.status.replace('_', ' ')}*`,
          `🎯 *Verification:* ${result.verificationResult}`,
          `📏 *Distance:* *${result.distanceMeters}m* from site center (Allowed radius: *${todayData.site.allowedRadiusMeters}m*)`,
          `🕒 *Time:* ${formattedTime} (${todayData.siteTimezone})`,
          '',
          isOutside
            ? `⛔ *WARNING:* You are currently too far from the site perimeter (${result.distanceMeters}m > ${todayData.site.allowedRadiusMeters}m). Your check-in has been marked as OUTSIDE_GEOFENCE/LATE and flagged for supervisor review.`
            : `Have a productive and safe work shift!`,
        ];

        await this.sendMainMenu(chatId, replyLines.join('\n'));
      } else {
        // Perform CHECK-OUT
        const result = await this.attendanceService.checkOut(
          principal,
          locationInput,
          idempotencyKey,
        );

        const durationMinutes = result.workDurationMinutes || 0;
        const hours = Math.floor(durationMinutes / 60);
        const mins = durationMinutes % 60;
        const formattedTime = formatSiteDateTime(new Date(result.timestamp), todayData.siteTimezone);

        const replyLines = [
          `🏁 *Check-Out Successfully Recorded!*`,
          '',
          `👤 *Worker:* ${account.employee.fullName} (\`${account.employee.employeeCode}\`)`,
          `🏢 *Site:* *${todayData.site.name}*`,
          `⏱️ *Work Duration:* *${hours}h ${mins}m* (${durationMinutes} minutes)`,
          `📊 *Final Status:* *${result.status.replace('_', ' ')}*`,
          `📏 *Distance:* ${result.distanceMeters}m from site center`,
          `🕒 *Time:* ${formattedTime} (${todayData.siteTimezone})`,
          '',
          `Thank you for your hard work today!`,
        ];

        await this.sendMainMenu(chatId, replyLines.join('\n'));
      }
    } catch (err: any) {
      this.logger.error(`Error processing location attendance: ${err.message}`, err.stack);
      const errorMsg =
        err.message === 'NO_VALID_ASSIGNMENT'
          ? '⚠️ You do not have an active shift assignment scheduled for today.'
          : err.message === 'ALREADY_CHECKED_IN'
          ? 'ℹ️ You have already checked in today.'
          : err.message === 'NOT_CHECKED_IN'
          ? '⚠️ You have not checked in yet today.'
          : `❌ Attendance submission error: ${err.message}`;

      await this.sendMainMenu(chatId, errorMsg);
    }
  }

  /**
   * /status command: displays worker's current shift details and today's status.
   */
  private async handleStatusCommand(chatId: string, account: any): Promise<void> {
    const principal: WorkerPrincipal = {
      type: 'worker',
      organizationId: account.organizationId,
      employeeId: account.employeeId,
      telegramUserId: account.telegramUserId,
      sessionId: `tg-bot-${account.telegramUserId}`,
    };

    try {
      const today = await this.attendanceService.getWorkerToday(principal);
      const att = today.attendance;
      const rawStatus = att ? att.status.replace(/_/g, ' ') : 'NOT STARTED';

      const lines = [
        `📊 *Today's Attendance Status*`,
        `Date: \`${today.date}\` (${today.siteTimezone})`,
        '',
        `👤 *Worker:* ${account.employee.fullName} (\`${account.employee.employeeCode}\`)`,
        `🏢 *Site:* ${today.site.name}`,
        `⏰ *Shift:* ${today.schedule.startTime} - ${today.schedule.endTime} (${today.schedule.name})`,
        '',
        `• *Status:* ${rawStatus}`,
        `• *Check-In:* ${
          att?.checkInAt ? formatSiteDateTime(new Date(att.checkInAt), today.siteTimezone) : 'Pending'
        }`,
        `• *Check-Out:* ${
          att?.checkOutAt ? formatSiteDateTime(new Date(att.checkOutAt), today.siteTimezone) : 'Pending'
        }`,
        att?.workDurationMinutes !== null && att?.workDurationMinutes !== undefined
          ? `• *Duration:* ${Math.floor(att.workDurationMinutes / 60)}h ${att.workDurationMinutes % 60}m`
          : '',
      ].filter(Boolean);

      await this.sendMainMenu(chatId, lines.join('\n'));
    } catch (err: any) {
      if (err.message === 'NO_VALID_ASSIGNMENT') {
        await this.sendMainMenu(
          chatId,
          `ℹ️ You do not have an active work shift assigned for today. Contact your manager if you expect to work today.`,
        );
      } else {
        await this.sendMainMenu(chatId, `⚠️ Unable to load status: ${err.message}`);
      }
    }
  }

  /**
   * /help command.
   */
  private async handleHelpCommand(chatId: string): Promise<void> {
    const text = [
      `ℹ️ *Site Attendance Help & Commands*`,
      '',
      `• *Registration:* Tap "📱 Share Phone Number to Register" to get verified.`,
      `• *Check-In:* Tap *Open Attendance* and submit your GPS evidence.`,
      `• *Check-Out:* Tap *Open Attendance* and submit your GPS evidence.`,
      `• *Status:* Send \`/status\` to see your shift hours and check-in time.`,
      '',
      `📌 *Geofence Rule:* You must be within your assigned site's allowed perimeter when checking in. Location coordinates are verified on the server.`,
    ].join('\n');

    await this.sendMainMenu(chatId, text);
  }

  /**
   * Sends a message along with the persistent reply keyboard.
   */
  private async sendMainMenu(chatId: string, text: string): Promise<void> {
    const replyMarkup = {
      keyboard: [
        [{ text: '📷 Open Attendance', web_app: { url: this.webAppUrl } }],
        [{ text: '📊 Today Status' }, { text: 'ℹ️ Help' }],
      ],
      resize_keyboard: true,
    };

    await this.telegramNotifier.sendMessage(chatId, text, 'Markdown', replyMarkup);
  }

  /**
   * Answers a Telegram callback query.
   */
  private async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    const token =
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    } catch {
      // Ignore network errors on callback answers
    }
  }
}
