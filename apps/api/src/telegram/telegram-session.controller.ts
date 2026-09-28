import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { telegramSessionSchema, type TelegramSessionResponse } from '@workforce/contracts';
import { Public } from '../auth/decorators/public.decorator.js';
import { TelegramSessionService } from './telegram-session.service.js';

@Controller('telegram')
export class TelegramSessionController {
  constructor(private readonly sessionService: TelegramSessionService) {}

  @Public()
  @Post('session')
  @HttpCode(HttpStatus.OK)
  async createSession(@Body() body: unknown): Promise<TelegramSessionResponse> {
    const parseResult = telegramSessionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: parseResult.error.errors,
      });
    }

    return this.sessionService.createSession(parseResult.data.initData);
  }
}
