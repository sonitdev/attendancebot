import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface TelegramSendResult {
  success: boolean;
  messageId?: number;
  error?: string;
  /** True only when no Telegram send could have been accepted. */
  retryable?: boolean;
  /** A timeout, disconnect, malformed reply, or server error may hide an accepted send. */
  uncertain?: boolean;
  retryAfterMs?: number;
}

type TelegramReply = {
  ok?: boolean;
  result?: { message_id?: number };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

@Injectable()
export class TelegramNotifierService {
  private static readonly HTTP_TIMEOUT_MS = 20_000;
  private readonly logger = new Logger(TelegramNotifierService.name);
  private readonly botToken: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!this.botToken) this.logger.warn('TELEGRAM_BOT_TOKEN not configured; deliveries remain retryable.');
  }

  // The deadline includes reading the body, not only waiting for response headers.
  private async request<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TelegramNotifierService.HTTP_TIMEOUT_MS);
    try {
      return await read(await fetch(url, { ...init, signal: controller.signal }));
    } finally {
      clearTimeout(timeout);
    }
  }

  private classify(data: TelegramReply, status: number): TelegramSendResult {
    if (data.ok === true && typeof data.result?.message_id === 'number') {
      return { success: true, messageId: data.result.message_id };
    }
    // Even a 5xx JSON response can follow side effects; do not resend automatically.
    if (status >= 500 || data.ok !== false || !data.error_code || data.error_code >= 500) {
      return { success: false, uncertain: true, error: 'TELEGRAM_OUTCOME_UNKNOWN' };
    }
    const retryAfter = data.parameters?.retry_after;
    return {
      success: false,
      retryable: data.error_code === 429,
      uncertain: false,
      error: `TELEGRAM_REJECTED_${data.error_code}`,
      ...(typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
        ? { retryAfterMs: retryAfter * 1_000 } : {}),
    };
  }

  async sendMessage(
    telegramUserId: string,
    text: string,
    parseMode: 'Markdown' | 'HTML' = 'Markdown',
    replyMarkup?: Record<string, unknown>,
  ): Promise<TelegramSendResult> {
    if (!this.botToken) return { success: false, retryable: true, error: 'TELEGRAM_NOT_CONFIGURED' };
    const payload: Record<string, unknown> = {
      chat_id: telegramUserId, text, parse_mode: parseMode,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    };
    const send = () => this.request(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }, async (response) => ({ data: await response.json() as TelegramReply, status: response.status }));
    try {
      let reply = await send();
      // Only a definitive entity-parsing rejection permits a formatting fallback.
      if (reply.status === 400 && reply.data.ok === false && reply.data.error_code === 400 &&
          /parse entities|can't find end|unsupported start tag/i.test(reply.data.description ?? '')) {
        delete payload.parse_mode;
        reply = await send();
      }
      return this.classify(reply.data, reply.status);
    } catch {
      return { success: false, uncertain: true, error: 'TELEGRAM_OUTCOME_UNKNOWN' };
    }
  }

  async sendPhoto(chatId: string, storagePath: string, caption: string): Promise<TelegramSendResult> {
    const baseUrl = this.configService.get<string>('SUPABASE_URL') ?? process.env.SUPABASE_URL;
    const serviceKey = this.configService.get<string>('SUPABASE_SERVICE_ROLE_KEY') ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!this.botToken || !baseUrl || !serviceKey) {
      return { success: false, retryable: true, error: 'TELEGRAM_OR_STORAGE_NOT_CONFIGURED' };
    }
    let evidence: { bytes: ArrayBuffer; type: string } | null;
    try {
      evidence = await this.request(`${baseUrl}/storage/v1/object/attendance-evidence/${storagePath}`, {
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      }, async (response) => response.ok ? {
        bytes: await response.arrayBuffer(), type: response.headers.get('content-type') || 'image/jpeg',
      } : null);
    } catch {
      return { success: false, retryable: true, error: 'EVIDENCE_FETCH_FAILED' };
    }
    if (!evidence) return { success: false, retryable: true, error: 'EVIDENCE_FETCH_FAILED' };
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('caption', caption);
    form.set('photo', new Blob([evidence.bytes], { type: evidence.type }), 'attendance-proof.jpg');
    try {
      const reply = await this.request(`https://api.telegram.org/bot${this.botToken}/sendPhoto`, {
        method: 'POST', body: form,
      }, async (response) => ({ data: await response.json() as TelegramReply, status: response.status }));
      if (reply.status === 400 && reply.data.ok === false && reply.data.error_code === 400) {
        return this.sendMessage(chatId, caption, 'HTML');
      }
      return this.classify(reply.data, reply.status);
    } catch {
      // A failed response does not prove the photo was rejected. A text fallback could duplicate it.
      return { success: false, uncertain: true, error: 'TELEGRAM_OUTCOME_UNKNOWN' };
    }
  }
}
