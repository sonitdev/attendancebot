import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { km } from '@workforce/contracts';
import { AttendanceService } from '../attendance/attendance.service.js';
import { formatSiteDateTime, getSiteDate } from '../attendance/schedule-evaluator.js';
import type { WorkerPrincipal } from '../auth/principal.js';
import { ProjectAuthorizationService } from '../auth/project-authorization.service.js';
import { TelegramNotifierService } from '../jobs/telegram-notifier.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizePhone } from '../common/phone.util.js';
import { SalesService } from '../sales/sales.service.js';
import { RegistrationRequestsService } from '../registration-requests/registration-requests.service.js';

@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private isPolling = false;
  private lastUpdateId = 0;
  private readonly registrationApprovalInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceService: AttendanceService,
    private readonly telegramNotifier: TelegramNotifierService,
    private readonly configService: ConfigService,
    private readonly projectAuthorization: ProjectAuthorizationService,
    private readonly salesService: SalesService,
    private readonly registrationRequestsService: RegistrationRequestsService,
  ) { }

  private get webAppUrl(): string {
    const configuredUrl =
      this.configService.get<string>('TELEGRAM_MINI_APP_URL') ??
      process.env.TELEGRAM_MINI_APP_URL;

    if (!configuredUrl) {
      throw new Error('TELEGRAM_MINI_APP_URL is required before Telegram Mini App buttons can be sent.');
    }

    return configuredUrl.replace(/\/$/, '');
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

  private async releaseTelegramUpdateClaim(updateId: unknown): Promise<void> {
    if (!Number.isInteger(updateId) || !this.prisma.telegramUpdate?.deleteMany) return;
    try {
      await this.prisma.telegramUpdate.deleteMany({ where: { updateId: updateId as number } });
    } catch (error: any) {
      this.logger.warn(`Could not release Telegram update claim ${String(updateId)}: ${error?.message || error}`);
    }
  }

  private async startLongPolling(token: string): Promise<void> {
    this.isPolling = true;
    this.logger.log('Starting Telegram long-polling runner for @site_attendantbot...');

    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
      await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menu_button: {
            type: 'web_app',
            text: 'ចុះវត្តមាន',
            web_app: { url: this.webAppUrl },
          },
        }),
      });
    } catch {
      // ignore
    }

    void (async () => {
      while (this.isPolling) {
        try {
          const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
          const res = await fetch(url);
          const data = (await res.json()) as any;

          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
              try {
                await this.handleUpdate(update);
              } catch (updateErr: any) {
                await this.releaseTelegramUpdateClaim(update.update_id);
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

    // Telegram can deliver the same update to concurrent long-polling
    // processes. Claim it in PostgreSQL before producing any response.
    if (Number.isInteger(update.update_id) && this.prisma.telegramUpdate) {
      const claimed = await this.prisma.telegramUpdate.createMany({
        data: [{ updateId: update.update_id }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return;
    }

    // Handle inline button callback query
    if (update.callback_query) {
      const cb = update.callback_query;
      const chatId = String(cb.message?.chat?.id || cb.from.id);
      if (cb.data === 'register_phone') {
        await this.handleUnlinkedUser(chatId, cb.from);
      }
      if (cb.data === 'set_current_project') {
        await this.handleSetCurrentProject(chatId, cb.from);
      }
      if (typeof cb.data === 'string' && cb.data.startsWith('sales_report:')) {
        await this.handleSalesReportCallback(chatId, cb.from, cb.data);
      }
      if (typeof cb.data === 'string' && cb.data.startsWith('approve_reg:')) {
        await this.handleRegistrationApproval(chatId, cb.data.slice('approve_reg:'.length), true, cb.from);
      }
      if (typeof cb.data === 'string' && cb.data.startsWith('reject_reg:')) {
        await this.handleRegistrationApproval(chatId, cb.data.slice('reject_reg:'.length), false, cb.from);
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
    const isGroupChat = message.chat.type === 'group' || message.chat.type === 'supergroup';

    this.logger.debug(
      `Telegram update received: chatType=${message.chat.type}, hasText=${Boolean(text)}, hasLocation=${Boolean(location)}, hasContact=${Boolean(contact)}`,
    );

    // 1. A newly registered organization owner pairs privately first. A group
    // alone must never be used to infer a tenant.
    if (!isGroupChat && text.startsWith('/start owner_')) {
      await this.handleOwnerPairing(chatId, message.from, text.slice('/start owner_'.length));
      return;
    }
    if (!isGroupChat && text.startsWith('/start project_')) {
      await this.handleProjectJoin(chatId, message.from, text.slice('/start project_'.length));
      return;
    }

    // 2. Handle contact sharing for instant worker registration / authorization
    if (contact) {
      await this.handleContactRegistration(chatId, message.from, contact);
      return;
    }

    // 3. Resolve linked Telegram account
    let account = await this.resolveTelegramAccount(telegramUserId);

    // If no employee account found, check if user is a paired organization owner
    if (!account) {
      const pendingSelection = await this.resolvePendingProjectSelection(telegramUserId);
      const owner = await this.prisma.telegramOrganizationOwner.findFirst({
        where: {
          telegramUserId,
          pairedAt: { not: null },
          ...(pendingSelection ? { organizationId: pendingSelection.organizationId } : {}),
        },
        include: { organization: true },
      });
      if (owner) {
        account = await this.ensureOwnerEmployeeAndAccount(owner, message.from, pendingSelection?.projectId);
      }
    }

    if (isGroupChat && text.toLowerCase().startsWith('/connect')) {
      if (account?.status === 'ACTIVE') {
        await this.handleGroupConnect(chatId, message.chat.title, account);
        return;
      }
      const owner = await this.prisma.telegramOrganizationOwner.findFirst({
        where: { telegramUserId, pairedAt: { not: null } },
      });
      if (owner) {
        await this.handleGroupConnect(chatId, message.chat.title, { organizationId: owner.organizationId, employeeId: undefined });
        return;
      }
      const botUsername = this.configService.get<string>('TELEGRAM_BOT_USERNAME') ?? 'site_attendantbot';
      await this.telegramNotifier.sendMessage(chatId, km.telegram.ownerPairingRequired(`https://t.me/${botUsername}`), 'Markdown');
      return;
    }

    if (!account || account.status !== 'ACTIVE') {
      // Never prompt group members for personal registration details in a
      // shared chat. Registration must remain a direct-message flow.
      if (isGroupChat) return;

      // A contact can be recorded as a pending registration when it does not
      // match exactly one active employee. Keep that phone evidence private
      // and do not ask the person to share it again on every /start.
      const pendingRegistration = await this.prisma.registrationRequest.findFirst({
        where: { telegramUserId, status: 'PENDING' },
        select: { id: true },
      });
      if (pendingRegistration) {
        await this.telegramNotifier.sendMessage(chatId, km.telegram.registrationPending, 'Markdown', { remove_keyboard: true });
        return;
      }
      await this.handleUnlinkedUser(chatId, message.from);
      return;
    }

    if (!isGroupChat && text && !text.startsWith('/') && (await this.handleConversationReply(chatId, account, text))) {
      return;
    }

    // A verified worker can register a group, but cannot activate it or bind
    // it to a site. That authorization remains an admin-only next step.
    if (isGroupChat) {
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
    } else if (text === '/report' || textLower.includes('report')) {
      await this.startLatestSalesReport(chatId, account);
    } else {
      // Default: show main keyboard menu
      await this.sendMainMenu(
        chatId,
        km.telegram.mainMenuGreeting(account.employee.fullName),
      );
    }
  }

  private async handleOwnerPairing(chatId: string, from: any, setupCode: string): Promise<void> {
    if (!setupCode || setupCode.length < 20) return;
    const record = await this.prisma.telegramOrganizationOwner.findFirst({
      where: { setupCode, setupCodeUsedAt: null, setupCodeExpiresAt: { gt: new Date() } },
    });
    if (!record) return;
    await this.prisma.telegramOrganizationOwner.update({
      where: { id: record.id },
      data: { telegramUserId: String(from.id), telegramUsername: from.username ?? null, pairedAt: new Date(), setupCodeUsedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: { organizationId: record.organizationId, actorUserId: record.userId, action: 'TELEGRAM_OWNER_PAIRED', targetType: 'TelegramOrganizationOwner', targetId: record.id, metadata: { telegramUserId: String(from.id) } },
    });
    await this.telegramNotifier.sendMessage(chatId, km.telegram.ownerPairingComplete);
  }

  private async handleProjectJoin(chatId: string, from: any, projectId: string): Promise<void> {
    const telegramUserId = String(from.id);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { organization: true },
    });
    if (!project) return;
    if (project.telegramChatId && !(await this.isTelegramChatMember(project.telegramChatId, telegramUserId))) {
      return;
    }

    // 1. Search if this telegramUserId already exists anywhere in the system
    const existingAccount = await this.prisma.telegramAccount.findFirst({
      where: { telegramUserId, status: 'ACTIVE' },
      include: { employee: true, organization: true },
      orderBy: { linkedAt: 'desc' },
    });

    const owner = await this.prisma.telegramOrganizationOwner.findFirst({
      where: { telegramUserId, pairedAt: { not: null } },
      include: { organization: true },
    });

    // Case A: User ALREADY EXISTS in the system (joined before or is admin/owner)
    // Directly let them join this project and set as current without asking for phone number!
    if (existingAccount || owner) {
      let employee = await this.prisma.employee.findFirst({
        where: {
          organizationId: project.organizationId,
          OR: [
            { telegramAccount: { telegramUserId } },
            ...(existingAccount?.employee.normalizedPhone ? [{ normalizedPhone: existingAccount.employee.normalizedPhone }] : []),
          ],
        },
        include: { telegramAccount: true },
      });

      if (!employee) {
        const fullName = existingAccount?.employee.fullName || [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Member';
        const phone = existingAccount?.employee.phone || '';
        const normalizedPhone = existingAccount?.employee.normalizedPhone || null;
        const employeeCode = `EMP-${Math.floor(100000 + Math.random() * 900000)}`;

        employee = await this.prisma.employee.create({
          data: {
            organizationId: project.organizationId,
            employeeCode,
            fullName,
            phone,
            normalizedPhone,
            currentProjectId: project.id,
            status: 'ACTIVE',
          },
          include: { telegramAccount: true },
        });
      }

      await this.prisma.telegramAccount.upsert({
        where: { employeeId: employee.id },
        create: {
          organizationId: project.organizationId,
          employeeId: employee.id,
          telegramUserId,
          username: from.username || null,
          firstName: from.first_name || null,
          lastName: from.last_name || null,
          status: 'ACTIVE',
        },
        update: {
          telegramUserId,
          username: from.username || null,
          firstName: from.first_name || null,
          lastName: from.last_name || null,
          status: 'ACTIVE',
        },
      });

      // Authorize worker for this project and set as current
      await this.prisma.workerProject.upsert({
        where: { employeeId_projectId: { employeeId: employee.id, projectId: project.id } },
        create: {
          organizationId: project.organizationId,
          employeeId: employee.id,
          projectId: project.id,
          lastSelectedAt: new Date(),
          lastVerifiedAt: new Date(),
          authorizationStatus: 'AUTHORIZED',
          lastVerificationResult: 'MEMBERSHIP_VERIFIED',
        },
        update: {
          lastSelectedAt: new Date(),
          lastVerifiedAt: new Date(),
          authorizationStatus: 'AUTHORIZED',
          revokedAt: null,
          lastVerificationResult: 'MEMBERSHIP_VERIFIED',
        },
      });

      await this.prisma.employee.update({
        where: { id: employee.id },
        data: { currentProjectId: project.id },
      });

      await this.projectAuthorization.ensureProjectSiteAndAssignment(
        project.organizationId,
        project.id,
        employee.id,
      );

      // Clear any pending selections
      await this.prisma.pendingTelegramProjectSelection.deleteMany({
        where: { telegramUserId },
      });

      await this.sendMainMenu(
        chatId,
        `✅ អ្នកបានចូលរួម និងប្ដូរទៅកាន់គម្រោង «${project.name}» ដោយជោគជ័យ!\nអ្នកអាចចាប់ផ្ដើមកត់ត្រាវត្តមានសម្រាប់គម្រោងនេះបានហើយ។`,
      );
      return;
    }

    // Case B: User HAS NOT JOINED BEFORE (new user onboarding)
    await this.prisma.pendingTelegramProjectSelection.deleteMany({
      where: { telegramUserId },
    });
    await this.prisma.pendingTelegramProjectSelection.create({
      data: {
        organizationId: project.organizationId,
        telegramUserId,
        projectId: project.id,
        sourceChatId: project.telegramChatId || chatId,
      },
    });

    // Check if there is already a pending registration request for this user in this org
    const pendingRegistration = await this.prisma.registrationRequest.findFirst({
      where: { telegramUserId, organizationId: project.organizationId, status: 'PENDING' },
    });
    if (pendingRegistration) {
      await this.telegramNotifier.sendMessage(chatId, km.telegram.registrationPending, 'Markdown', { remove_keyboard: true });
      return;
    }

    await this.handleUnlinkedUser(chatId, from);
  }

  /**
   * Ensures an employee record and active TelegramAccount exist for a paired organization owner.
   */
  private async ensureOwnerEmployeeAndAccount(
    owner: { id: string; organizationId: string; userId: string; telegramUserId: string | null },
    from: any,
    projectId?: string,
    phone?: string,
    normalizedPhone?: string | null,
  ): Promise<any> {
    const telegramUserId = String(from.id);
    const orgId = owner.organizationId;

    let employee = await this.prisma.employee.findFirst({
      where: {
        organizationId: orgId,
        telegramAccount: { telegramUserId },
      },
      include: { organization: true, telegramAccount: true },
    });

    if (!employee && normalizedPhone) {
      employee = await this.prisma.employee.findFirst({
        where: { organizationId: orgId, normalizedPhone },
        include: { organization: true, telegramAccount: true },
      });
    }

    if (!employee) {
      const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Owner';
      const employeeCode = `OWN-${Math.floor(100000 + Math.random() * 900000)}`;

      employee = await this.prisma.employee.create({
        data: {
          organizationId: orgId,
          employeeCode,
          fullName,
          phone: phone || '',
          normalizedPhone: normalizedPhone || null,
          status: 'ACTIVE',
          ...(projectId ? { currentProjectId: projectId } : {}),
        },
        include: { organization: true, telegramAccount: true },
      });
    } else if (normalizedPhone && !employee.normalizedPhone) {
      employee = await this.prisma.employee.update({
        where: { id: employee.id },
        data: { phone: phone || employee.phone, normalizedPhone },
        include: { organization: true, telegramAccount: true },
      });
    }

    let account = await this.prisma.telegramAccount.findFirst({
      where: { telegramUserId, organizationId: orgId },
      include: { employee: true, organization: true },
    });

    if (!account) {
      account = await this.prisma.telegramAccount.create({
        data: {
          organizationId: orgId,
          employeeId: employee.id,
          telegramUserId,
          username: from.username || null,
          firstName: from.first_name || null,
          lastName: from.last_name || null,
          status: 'ACTIVE',
        },
        include: { employee: true, organization: true },
      });
    }

    if (projectId) {
      await this.prisma.workerProject.upsert({
        where: { employeeId_projectId: { employeeId: employee.id, projectId } },
        create: {
          organizationId: orgId,
          employeeId: employee.id,
          projectId,
          lastSelectedAt: new Date(),
          lastVerifiedAt: new Date(),
          authorizationStatus: 'AUTHORIZED',
          lastVerificationResult: 'MEMBERSHIP_VERIFIED',
        },
        update: {
          lastSelectedAt: new Date(),
          lastVerifiedAt: new Date(),
          authorizationStatus: 'AUTHORIZED',
          revokedAt: null,
          lastVerificationResult: 'MEMBERSHIP_VERIFIED',
        },
      });
      await this.prisma.employee.update({
        where: { id: employee.id },
        data: { currentProjectId: projectId },
      });
    }

    // Resolve any pending registration requests for this owner
    await this.prisma.registrationRequest.updateMany({
      where: { telegramUserId, organizationId: orgId, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        reviewedByUserId: owner.userId,
        createdEmployeeId: employee.id,
      },
    });

    return account;
  }

  private workerPrincipal(account: any): WorkerPrincipal {
    return {
      type: 'worker',
      organizationId: account.organizationId,
      employeeId: account.employeeId,
      telegramUserId: account.telegramUserId,
      sessionId: 'telegram-private-assistant',
    };
  }

  /**
   * A Telegram user ID is an external identifier, not a tenant identity.  A
   * direct bot message has no organization context, so it is intentionally
   * rejected when it maps to more than one active organization.
   */
  private async resolveTelegramAccount(telegramUserId: string, organizationId?: string) {
    if (organizationId) {
      return this.prisma.telegramAccount.findFirst({
        where: {
          telegramUserId,
          organizationId,
          status: 'ACTIVE',
        },
        include: { employee: true, organization: true },
      });
    }

    // If no org specified, check if user has a recent pending project selection
    const pending = await this.resolvePendingProjectSelection(telegramUserId);
    if (pending) {
      const pendingAccount = await this.prisma.telegramAccount.findFirst({
        where: { telegramUserId, organizationId: pending.organizationId, status: 'ACTIVE' },
        include: { employee: true, organization: true },
      });
      if (pendingAccount) return pendingAccount;
    }

    // Default to the most recently linked active account
    return this.prisma.telegramAccount.findFirst({
      where: {
        telegramUserId,
        status: 'ACTIVE',
      },
      include: { employee: true, organization: true },
      orderBy: { linkedAt: 'desc' },
    });
  }

  private async resolvePendingProjectSelection(telegramUserId: string) {
    if (typeof this.prisma.pendingTelegramProjectSelection?.findFirst === 'function') {
      return this.prisma.pendingTelegramProjectSelection.findFirst({
        where: { telegramUserId },
        orderBy: { updatedAt: 'desc' },
      });
    }
    if (typeof this.prisma.pendingTelegramProjectSelection?.findMany === 'function') {
      const list = await this.prisma.pendingTelegramProjectSelection.findMany({
        where: { telegramUserId },
      });
      return list[0] ?? null;
    }
    return null;
  }

  private async handleSalesReportCallback(chatId: string, from: any, data: string): Promise<void> {
    const account = await this.resolveTelegramAccount(String(from.id));
    if (!account || account.status !== 'ACTIVE') {
      await this.telegramNotifier.sendMessage(chatId, km.telegram.projectUnavailable);
      return;
    }
    const [action, reportId] = data.split(':');
    if (!reportId) return;
    const principal = this.workerPrincipal(account);
    if (action === 'sales_report') {
      await this.startSalesReportAssistant(chatId, principal, reportId);
      return;
    }
    if (action === 'sales_report_note') {
      await this.prisma.telegramConversationState.upsert({
        where: { organizationId_telegramUserId: { organizationId: account.organizationId, telegramUserId: account.telegramUserId } },
        create: { organizationId: account.organizationId, telegramUserId: account.telegramUserId, state: 'AWAITING_REPORT_NOTE', context: { reportId }, expiresAt: new Date(Date.now() + 86_400_000) },
        update: { state: 'AWAITING_REPORT_NOTE', context: { reportId }, expiresAt: new Date(Date.now() + 86_400_000) },
      });
      await this.telegramNotifier.sendMessage(chatId, km.telegram.salesReportNotePrompt);
      return;
    }
    if (action === 'sales_report_submit') {
      await this.salesService.submitReport(principal, reportId);
      await this.prisma.telegramConversationState.deleteMany({ where: { organizationId: account.organizationId, telegramUserId: account.telegramUserId } });
      await this.telegramNotifier.sendMessage(chatId, km.telegram.salesReportSubmitted);
    }
  }

  private async startLatestSalesReport(chatId: string, account: any): Promise<void> {
    try {
      const report = await this.salesService.getWorkerSalesDay(this.workerPrincipal(account));
      await this.startSalesReportAssistant(chatId, this.workerPrincipal(account), report.id);
    } catch {
      await this.telegramNotifier.sendMessage(chatId, km.telegram.salesReportNotAvailable);
    }
  }

  private async startSalesReportAssistant(chatId: string, principal: WorkerPrincipal, reportId: string): Promise<void> {
    const report = await this.salesService.getWorkerReport(principal, reportId);
    const missingIndex = report.visits.findIndex((visit: any) => visit.needsContext);
    if (missingIndex >= 0) {
      const visit = report.visits[missingIndex];
      await this.prisma.telegramConversationState.upsert({
        where: { organizationId_telegramUserId: { organizationId: principal.organizationId, telegramUserId: principal.telegramUserId } },
        create: { organizationId: principal.organizationId, telegramUserId: principal.telegramUserId, state: 'AWAITING_VISIT_CONTEXT', context: { reportId, visitId: visit.id }, expiresAt: new Date(Date.now() + 86_400_000) },
        update: { state: 'AWAITING_VISIT_CONTEXT', context: { reportId, visitId: visit.id }, expiresAt: new Date(Date.now() + 86_400_000) },
      });
      await this.telegramNotifier.sendMessage(
        chatId,
        km.telegram.salesReportVisitPrompt(missingIndex + 1, visit.outlet?.name ?? visit.customerName ?? km.telegram.unknownOutlet),
      );
      return;
    }
    await this.prisma.telegramConversationState.deleteMany({ where: { organizationId: principal.organizationId, telegramUserId: principal.telegramUserId } });
    await this.telegramNotifier.sendMessage(chatId, km.telegram.salesReportComplete, 'Markdown', {
      inline_keyboard: [[
        { text: km.telegram.addReportNote, callback_data: `sales_report_note:${reportId}` },
        { text: km.telegram.submitSalesReport, callback_data: `sales_report_submit:${reportId}` },
      ]],
    });
  }

  private async handleConversationReply(chatId: string, account: any, text: string): Promise<boolean> {
    const state = await this.prisma.telegramConversationState.findFirst({ where: { organizationId: account.organizationId, telegramUserId: account.telegramUserId } });
    if (!state || state.expiresAt <= new Date()) return false;
    const context = state.context as { reportId?: string; visitId?: string };
    if (!context.reportId) return false;
    const principal = this.workerPrincipal(account);
    if (state.state === 'AWAITING_VISIT_CONTEXT' && context.visitId) {
      await this.salesService.updateVisitContext(principal, context.reportId, context.visitId, { workerStatement: text });
      await this.startSalesReportAssistant(chatId, principal, context.reportId);
      return true;
    }
    if (state.state === 'AWAITING_REPORT_NOTE') {
      await this.salesService.updateReport(principal, context.reportId, { additionalNote: text });
      await this.startSalesReportAssistant(chatId, principal, context.reportId);
      return true;
    }
    return false;
  }

  private async handleGroupConnect(chatId: string, title: string | undefined, account: { organizationId: string; employeeId?: string }): Promise<void> {
    // A real chat must have one reporting ownership record. If legacy data has
    // more than one, do not select an organization implicitly.
    const existingGroups = await this.prisma.telegramReportGroup.findMany({
      where: { chatId },
      take: 2,
    });
    const existing = existingGroups.length === 1 ? existingGroups[0] : null;

    if (existingGroups.length > 1) {
      await this.telegramNotifier.sendMessage(chatId, km.telegram.groupBelongsToAnotherOrganization);
      return;
    }

    if (existing && existing.organizationId !== account.organizationId) {
      await this.telegramNotifier.sendMessage(
        chatId,
        km.telegram.groupBelongsToAnotherOrganization,
      );
      return;
    }

    if (existing) {
      await this.prisma.telegramReportGroup.update({
        where: { id: existing.id },
        data: { title: title || null },
      });
      const linkedSite = existing.siteId
        ? await this.prisma.site.findFirst({ where: { id: existing.siteId, organizationId: account.organizationId }, include: { project: true } })
        : null;
      if (linkedSite?.project) {
        const updatedProject = await this.prisma.project.update({
          where: { id: linkedSite.project.id },
          data: {
            telegramChatId: chatId,
            name: title || linkedSite.project.name,
            status: 'ACTIVE',
            telegramConnectionStatus: 'CONNECTED',
            telegramConnectedAt: new Date(),
          },
        });
        // A group can be reconnected after it already has a project. The
        // worker onboarding action must still be published in the group; the
        // old connection-status message gave members no way to begin the
        // private registration flow.
        await this.sendProjectJoin(chatId, updatedProject);
      } else {
        const linkedProject = await this.prisma.project.findFirst({ where: { organizationId: account.organizationId, telegramChatId: chatId } });
        if (linkedProject) {
          const updatedProject = await this.prisma.project.update({
            where: { id: linkedProject.id },
            data: {
              name: title || linkedProject.name,
              status: 'ACTIVE',
              telegramConnectionStatus: 'CONNECTED',
              telegramConnectedAt: new Date(),
            },
          });
          await this.sendProjectJoin(chatId, updatedProject);
        } else {
          const code = `TG-${chatId.replace(/[^0-9]/g, '').slice(-10) || Date.now()}`;
          const project = await this.prisma.project.create({
            data: {
              organizationId: account.organizationId,
              code,
              name: title || code,
              status: 'ACTIVE',
              telegramChatId: chatId,
              telegramConnectionStatus: 'CONNECTED',
              telegramConnectedAt: new Date(),
            },
          });
          await this.sendProjectJoin(chatId, project);
        }
      }
      return;
    }

    const code = `TG-${chatId.replace(/[^0-9]/g, '').slice(-10) || Date.now()}`;
    const project = await this.prisma.project.create({
      data: {
        organizationId: account.organizationId,
        code,
        name: title || code,
        status: 'ACTIVE',
        telegramChatId: chatId,
        telegramConnectionStatus: 'CONNECTED',
        telegramConnectedAt: new Date(),
      },
    });
    await this.prisma.telegramReportGroup.create({
      data: {
        organizationId: account.organizationId,
        chatId,
        title: title || null,
        connectedByEmployeeId: account.employeeId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        organizationId: account.organizationId,
        action: 'TELEGRAM_REPORT_GROUP_CONNECTED',
        targetType: 'Project',
        targetId: project.id,
        metadata: { telegramChatId: chatId, title: title || null, connectedByEmployeeId: account.employeeId },
      },
    });

    await this.sendProjectJoin(chatId, project);
  }

  private async sendProjectJoin(chatId: string, project: { id: string; name: string }): Promise<void> {
    const username = this.configService.get<string>('TELEGRAM_BOT_USERNAME') ?? 'site_attendantbot';
    await this.telegramNotifier.sendMessage(chatId, km.telegram.projectJoinReady(project.name), 'Markdown', { inline_keyboard: [[{ text: km.telegram.joinProject(project.name), url: `https://t.me/${username}?start=project_${project.id}` }]] });
  }

  private async sendProjectConnectionState(chatId: string, active: boolean): Promise<void> {
    if (active) {
      await this.sendProjectConnected(chatId);
      return;
    }
    await this.telegramNotifier.sendMessage(chatId, km.telegram.groupAlreadyConnected);
  }

  private async sendProjectConnected(chatId: string): Promise<void> {
    await this.telegramNotifier.sendMessage(chatId, km.telegram.projectConnected, 'Markdown', {
      inline_keyboard: [[{ text: km.telegram.setCurrentProject, callback_data: 'set_current_project' }]],
    });
  }

  private async handleSetCurrentProject(chatId: string, from: any): Promise<void> {
    const projects = await this.prisma.project.findMany({ where: { telegramChatId: chatId }, take: 2 });
    const project = projects.length === 1 ? projects[0] : null;
    const account = project ? await this.resolveTelegramAccount(String(from.id), project.organizationId) : null;
    if (!project || project.status !== 'ACTIVE' || project.telegramConnectionStatus !== 'CONNECTED') {
      await this.telegramNotifier.sendMessage(chatId, km.telegram.projectUnavailable);
      return;
    }
    if (!(await this.isTelegramChatMember(chatId, String(from.id)))) {
      await this.prisma.auditLog.create({
        data: {
          organizationId: project.organizationId,
          action: 'PROJECT_ACCESS_DENIED',
          targetType: 'Project',
          targetId: project.id,
          metadata: { telegramUserId: String(from.id), source: 'BOT_BUTTON', reason: 'TELEGRAM_GROUP_MEMBERSHIP_REQUIRED' },
        },
      });
      await this.telegramNotifier.sendMessage(chatId, km.telegram.projectUnavailable);
      return;
    }
    if (!account || account.status !== 'ACTIVE') {
      await this.prisma.pendingTelegramProjectSelection.upsert({
        where: { organizationId_telegramUserId: { organizationId: project.organizationId, telegramUserId: String(from.id) } },
        create: { organizationId: project.organizationId, telegramUserId: String(from.id), projectId: project.id, sourceChatId: chatId },
        update: { organizationId: project.organizationId, projectId: project.id, sourceChatId: chatId },
      });
      const botUsername = this.configService.get<string>('TELEGRAM_BOT_USERNAME') ?? 'site_attendantbot';
      await this.telegramNotifier.sendMessage(chatId, km.telegram.registrationRequired(`https://t.me/${botUsername}?start=register`), 'Markdown');
      return;
    }
    if (project.organizationId !== account.organizationId) {
      await this.telegramNotifier.sendMessage(chatId, km.telegram.projectUnavailable);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.workerProject.upsert({
        where: { employeeId_projectId: { employeeId: account.employeeId, projectId: project.id } },
        create: { organizationId: account.organizationId, employeeId: account.employeeId, projectId: project.id, lastSelectedAt: new Date(), lastVerifiedAt: new Date(), authorizationStatus: 'AUTHORIZED', lastVerificationResult: 'MEMBERSHIP_VERIFIED' },
        update: { lastSelectedAt: new Date(), lastVerifiedAt: new Date(), authorizationStatus: 'AUTHORIZED', revokedAt: null, lastVerificationResult: 'MEMBERSHIP_VERIFIED' },
      });
      await tx.employee.update({ where: { id: account.employeeId }, data: { currentProjectId: project.id } });
      await tx.auditLog.create({ data: { organizationId: account.organizationId, action: 'WORKER_CURRENT_PROJECT_SET', targetType: 'Project', targetId: project.id, metadata: { employeeId: account.employeeId, telegramChatId: chatId } } });
    });
    await this.telegramNotifier.sendMessage(chatId, km.telegram.currentProjectUpdated);
  }

  private async isTelegramChatMember(chatId: string, telegramUserId: string): Promise<boolean> {
    const result = await this.projectAuthorization.verifyTelegramMembership(chatId, telegramUserId);
    return result.authorized;
  }

  private async applyPendingProjectSelection(telegramUserId: string, employeeId: string, organizationId: string): Promise<void> {
    const pending = await this.prisma.pendingTelegramProjectSelection.findFirst({ where: { organizationId, telegramUserId } });
    if (!pending || pending.organizationId !== organizationId) return;

    await this.projectAuthorization.authorizeWorkerProject(
      {
        type: 'worker',
        organizationId,
        employeeId,
        telegramUserId,
        sessionId: 'registration',
      },
      pending.projectId,
      'REGISTRATION',
      false,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.workerProject.upsert({
        where: { employeeId_projectId: { employeeId, projectId: pending.projectId } },
        create: { organizationId, employeeId, projectId: pending.projectId, lastSelectedAt: new Date(), lastVerifiedAt: new Date(), authorizationStatus: 'AUTHORIZED', lastVerificationResult: 'MEMBERSHIP_VERIFIED' },
        update: { lastSelectedAt: new Date(), lastVerifiedAt: new Date(), authorizationStatus: 'AUTHORIZED', revokedAt: null, lastVerificationResult: 'MEMBERSHIP_VERIFIED' },
      });
      await tx.employee.update({ where: { id: employeeId }, data: { currentProjectId: pending.projectId } });
      await tx.pendingTelegramProjectSelection.delete({ where: { id: pending.id } });
      await tx.auditLog.create({
        data: { organizationId, action: 'WORKER_CURRENT_PROJECT_SET', targetType: 'Project', targetId: pending.projectId, metadata: { employeeId, telegramUserId, sourceChatId: pending.sourceChatId, source: 'REGISTRATION' } },
      });
    });

    await this.projectAuthorization.ensureProjectSiteAndAssignment(
      organizationId,
      pending.projectId,
      employeeId,
    );
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
        km.telegram.verifyOwnContact,
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
        km.telegram.invalidPhone,
        'Markdown',
      );
      return;
    }

    // 1. Resolve pending project selection if available
    const pendingSelection = await this.resolvePendingProjectSelection(telegramUserId);

    // 2. Check if already linked
    const existingAccount = await this.resolveTelegramAccount(telegramUserId, pendingSelection?.organizationId);

    if (existingAccount) {
      if (!existingAccount.employee.normalizedPhone && normPhone) {
        await this.prisma.employee.update({
          where: { id: existingAccount.employee.id },
          data: { normalizedPhone: normPhone },
        });
      }

      await this.applyPendingProjectSelection(telegramUserId, existingAccount.employeeId, existingAccount.organizationId);

      await this.sendMainMenu(
        chatId,
        km.telegram.alreadyRegistered(existingAccount.employee.fullName, existingAccount.employee.employeeCode, existingAccount.organization.name),
      );
      return;
    }

    // 3. Check if user is a paired organization owner
    const owner = await this.prisma.telegramOrganizationOwner.findFirst({
      where: {
        telegramUserId,
        pairedAt: { not: null },
        ...(pendingSelection ? { organizationId: pendingSelection.organizationId } : {}),
      },
      include: { organization: true },
    });

    if (owner) {
      const ownerAccount = await this.ensureOwnerEmployeeAndAccount(
        owner,
        from,
        pendingSelection?.projectId,
        rawPhone,
        normPhone,
      );
      if (pendingSelection) {
        await this.applyPendingProjectSelection(telegramUserId, ownerAccount.employeeId, owner.organizationId);
      }
      await this.sendMainMenu(
        chatId,
        km.telegram.registrationSuccess(
          ownerAccount.employee.fullName,
          ownerAccount.employee.employeeCode,
          ownerAccount.organization.name,
        ),
      );
      return;
    }

    if (!pendingSelection) {
      await this.telegramNotifier.sendMessage(chatId, km.telegram.registrationNeedsProject, 'Markdown', { remove_keyboard: true });
      return;
    }
    let matchedEmployees = await this.prisma.employee.findMany({
      where: {
        organizationId: pendingSelection.organizationId,
        normalizedPhone: normPhone,
        status: 'ACTIVE',
      },
      include: { telegramAccount: true, organization: true },
    });

    // Fallback search for legacy records where normalizedPhone was not set at creation time
    if (matchedEmployees.length === 0 && digits.length >= 6) {
      const allActive = await this.prisma.employee.findMany({
        where: { status: 'ACTIVE', organizationId: pendingSelection.organizationId },
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
      const orgId = pendingSelection?.organizationId;

      if (!orgId) {
        await this.telegramNotifier.sendMessage(chatId, km.telegram.registrationNeedsProject);
        return;
      }

      const existingReq = await this.prisma.registrationRequest.findFirst({
        where: { telegramUserId, organizationId: orgId, status: 'PENDING' },
      });

      if (!existingReq) {
        const newRequest = await this.prisma.registrationRequest.create({
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

        // Notify the admins in the group AND the owner privately with approve/reject buttons
        void this.notifyAdminsOfRegistration(newRequest);
      }

      await this.telegramNotifier.sendMessage(
        chatId,
        km.telegram.registrationPending,
        'Markdown',
        { remove_keyboard: true },
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

    await this.applyPendingProjectSelection(telegramUserId, matchedEmployee.id, orgId);

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

    await this.sendMainMenu(
      chatId,
      km.telegram.registrationSuccess(
        matchedEmployee.fullName,
        matchedEmployee.employeeCode,
        matchedEmployee.organization.name,
      ),
    );
  }

  /**
   * Prompts unlinked Telegram user to share their phone number to register.
   */
  private async handleUnlinkedUser(chatId: string, from: any): Promise<void> {
    const text = km.telegram.unlinkedWelcome(from.first_name || '');

    const replyMarkup = {
      keyboard: [
        [{ text: km.telegram.sharePhone, request_contact: true }],
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
    const text = km.telegram.startWelcome(account.employee.fullName, account.employee.employeeCode, account.organization.name);

    await this.sendMainMenu(chatId, text);
  }

  /**
   * Check-in must use the Mini App so photo capture and GPS evidence stay together.
   */
  private async promptLocationCheckIn(chatId: string, account: any): Promise<void> {
    const text = km.telegram.checkInPrompt(account.employee.fullName);
    await this.sendMainMenu(chatId, text);
  }

  /** Check-out also uses the Mini App so the worker sees the confirmed result. */
  private async promptLocationCheckOut(chatId: string, account: any): Promise<void> {
    const text = km.telegram.checkOutPrompt(account.employee.fullName);
    await this.sendMainMenu(chatId, text);
  }

  /**
   * Handles incoming native GPS location evidence.
   */
  private async handleLocationAttendance(
    chatId: string,
    account: any,
    _location: { latitude: number; longitude: number; horizontal_accuracy?: number },
    _messageId: number,
    _timestampSeconds?: number,
  ): Promise<void> {
    const principal: WorkerPrincipal = {
      type: 'worker',
      organizationId: account.organizationId,
      employeeId: account.employeeId,
      telegramUserId: account.telegramUserId,
      sessionId: `tg-bot-${account.telegramUserId}`,
    };

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
        // Official check-in requires camera proof in the Mini App. A native
        // Telegram location message must never bypass that evidence rule.
        await this.promptLocationCheckIn(chatId, account);
        return;
      } else {
        await this.promptLocationCheckOut(chatId, account);
      }
    } catch (err: any) {
      this.logger.warn(`Unable to resolve attendance intent: ${err instanceof Error ? err.message : 'UNKNOWN_ERROR'}`);
      await this.sendMainMenu(chatId, km.telegram.statusLoadFailed);
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
      const status = att ? km.status[att.status as keyof typeof km.status] ?? att.status : km.status.NOT_STARTED;
      const checkIn = att?.checkInAt ? formatSiteDateTime(new Date(att.checkInAt), today.siteTimezone) : km.telegram.pendingValue;
      const checkOut = att?.checkOutAt ? formatSiteDateTime(new Date(att.checkOutAt), today.siteTimezone) : km.telegram.pendingValue;
      const duration = att?.workDurationMinutes !== null && att?.workDurationMinutes !== undefined
        ? km.telegram.durationHoursMinutes(Math.floor(att.workDurationMinutes / 60), att.workDurationMinutes % 60)
        : '';
      await this.sendMainMenu(
        chatId,
        km.telegram.attendanceStatusSummary(
          today.date,
          today.siteTimezone,
          account.employee.fullName,
          account.employee.employeeCode,
          today.site.name,
          `${today.schedule.startTime} - ${today.schedule.endTime} (${today.schedule.name})`,
          status,
          checkIn,
          checkOut,
          duration,
        ),
      );
    } catch (err: any) {
      if (err.message === 'NO_VALID_ASSIGNMENT') {
        await this.sendMainMenu(
          chatId,
          km.telegram.noAssignmentToday,
        );
      } else {
        await this.sendMainMenu(chatId, km.telegram.statusLoadFailed);
      }
    }
  }

  /**
   * /help command.
   */
  private async handleHelpCommand(chatId: string): Promise<void> {
    await this.sendMainMenu(chatId, km.telegram.helpText);
  }

  /**
   * Sends a message along with the persistent reply keyboard.
   */
  private async sendMainMenu(chatId: string, text: string): Promise<void> {
    const replyMarkup = {
      keyboard: [
        [{ text: km.telegram.openAttendance, web_app: { url: this.webAppUrl } }],
        [{ text: km.telegram.todayStatusButton }, { text: km.telegram.helpButton }],
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

  /**
   * Sends registration approval controls only to the paired organization
   * owner's private chat. Approval controls must never be broadcast to a
   * group, where every member could press them.
   */
  private async notifyAdminsOfRegistration(
    request: {
      id: string;
      organizationId: string;
      telegramFirstName: string | null;
      telegramLastName: string | null;
      telegramUsername: string | null;
      phone: string;
    },
  ): Promise<void> {
    try {
      const name = [request.telegramFirstName, request.telegramLastName].filter(Boolean).join(' ') || 'Unknown';
      const text = km.telegram.ownerRegistrationNotification(name, request.phone, request.telegramUsername);
      const replyMarkup = {
        inline_keyboard: [
          [
            { text: km.telegram.approveRegistration, callback_data: `approve_reg:${request.id}` },
            { text: km.telegram.rejectRegistration, callback_data: `reject_reg:${request.id}` },
          ],
        ],
      };

      // Send only to the paired organization owner privately.
      const owner = await this.prisma.telegramOrganizationOwner.findFirst({
        where: { organizationId: request.organizationId, pairedAt: { not: null }, telegramUserId: { not: null } },
      });

      if (owner?.telegramUserId && !String(owner.telegramUserId).startsWith('-')) {
        try {
          await this.telegramNotifier.sendMessage(owner.telegramUserId, text, 'Markdown', replyMarkup);
        } catch (err: any) {
          this.logger.warn(`Could not send registration request to owner ${owner.telegramUserId}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to notify admins of registration request ${request.id}: ${err.message}`);
    }
  }

  /**
   * Handles admin/owner approve/reject callback for a pending registration request.
   * On approval the worker receives the main menu so they can start checking in
   * immediately.
   */
  private async handleRegistrationApproval(chatId: string, requestId: string, approved: boolean, from?: any): Promise<void> {
    if (this.registrationApprovalInFlight.has(requestId)) return;
    this.registrationApprovalInFlight.add(requestId);
    try {
      const request = await this.prisma.registrationRequest.findFirst({
        where: { id: requestId },
      });

      if (!request) {
        // Stale callback buttons are intentionally silent. Sending a response
        // for every stale callback can flood the owner chat when Telegram
        // retries an update.
        return;
      }

      if (request.status !== 'PENDING') {
        return;
      }

      // Look up the owner user to use as the reviewer
      const owner = await this.prisma.telegramOrganizationOwner.findFirst({
        where: { organizationId: request.organizationId, pairedAt: { not: null }, telegramUserId: { not: null } },
      });

      const senderTelegramUserId = from?.id == null ? '' : String(from.id);
      const isPrivateOwnerChat = !String(chatId).startsWith('-') && senderTelegramUserId === owner?.telegramUserId;
      if (!isPrivateOwnerChat) {
        // Never reply in a group for approval callbacks. The request and all
        // approval controls belong exclusively in the owner's private chat.
        return;
      }

      const reviewerUserId = owner?.userId ?? 'telegram-admin';

      await this.registrationRequestsService.resolveRequest(
        request.organizationId,
        requestId,
        { approved, reviewNote: approved ? undefined : undefined },
        reviewerUserId,
      );

      const workerName = [request.telegramFirstName, request.telegramLastName].filter(Boolean).join(' ') || 'Worker';
      const reviewerName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || 'Admin';

      if (approved) {
        // Confirm to the group/chat
        await this.telegramNotifier.sendMessage(
          chatId,
          `✅ សំណើចុះឈ្មោះរបស់ ${workerName} ត្រូវបានអនុម័តដោយ ${reviewerName}។`,
        );

        // Send the worker the main menu so they can start using the bot immediately
        // RegistrationRequestsService sends the worker exactly one success
        // message with the Mini App button after the transaction commits.
      } else {
        // Confirm to the group/chat
        await this.telegramNotifier.sendMessage(
          chatId,
          `❌ សំណើចុះឈ្មោះរបស់ ${workerName} ត្រូវបានបដិសេធដោយ ${reviewerName}។`,
        );
      }
    } catch (err: any) {
      if (err?.message === 'REGISTRATION_REQUEST_ALREADY_RESOLVED') return;
      this.logger.error(`Failed to handle registration approval for ${requestId}: ${err.message}`);
      await this.telegramNotifier.sendMessage(chatId, km.telegram.registrationAlreadyResolved);
    } finally {
      this.registrationApprovalInFlight.delete(requestId);
    }
  }
}
