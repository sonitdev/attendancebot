import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramSendResult {
  success: boolean;
  messageId?: number;
  error?: string;
}

@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);
  private readonly botToken: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.botToken =
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!this.botToken) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured; notifications will be simulated.');
    }
  }

  async sendMessage(
    telegramUserId: string,
    text: string,
    parseMode: 'Markdown' | 'HTML' = 'Markdown',
    replyMarkup?: Record<string, unknown>,
  ): Promise<TelegramSendResult> {
    if (!this.botToken) {
      this.logger.log(`[Simulated Telegram Message to ${telegramUserId}]:\n${text}`);
      return { success: true, messageId: Math.floor(Math.random() * 1000000) };
    }

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const payload: Record<string, unknown> = {
        chat_id: telegramUserId,
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as any;

      if (!data.ok) {
        this.logger.warn(
          `Failed to deliver Telegram message to ${telegramUserId}: ${data.description || 'Unknown error'}. Retrying plain text...`,
        );

        // Fallback retry without parse_mode to guarantee delivery if Markdown parsing fails
        delete payload.parse_mode;
        const retryRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const retryData = (await retryRes.json()) as any;
        if (retryData.ok) {
          return { success: true, messageId: retryData.result?.message_id };
        }

        return { success: false, error: data.description };
      }

      return { success: true, messageId: data.result?.message_id };
    } catch (err: any) {
      this.logger.error(`Error delivering Telegram message to ${telegramUserId}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
