import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramBotService } from './telegram-bot.service.js';

@Controller('telegram')
export class TelegramWebhookController {
  private readonly webhookSecret: string | undefined;

  constructor(
    private readonly telegramBotService: TelegramBotService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret =
      this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET') ??
      process.env.TELEGRAM_WEBHOOK_SECRET;
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Body() body: unknown,
  ) {
    if (this.webhookSecret && secretHeader !== this.webhookSecret) {
      throw new UnauthorizedException('INVALID_WEBHOOK_SECRET');
    }

    // Fire update processing
    await this.telegramBotService.handleUpdate(body);

    return { ok: true };
  }

  @Get('bot-status')
  async getBotStatus() {
    const hasToken = !!(
      this.configService.get<string>('TELEGRAM_BOT_TOKEN') ?? process.env.TELEGRAM_BOT_TOKEN
    );
    return {
      status: 'operational',
      hasToken,
      webhookConfigured: !!this.webhookSecret,
    };
  }
}
