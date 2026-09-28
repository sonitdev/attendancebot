import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifiedTelegramUser = {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
};

@Injectable()
export class TelegramInitDataVerifier {
  verify(initData: string, botToken: string, now = new Date()): VerifiedTelegramUser {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get('hash');
    const authDate = params.get('auth_date');
    const userJson = params.get('user');

    if (!receivedHash || !authDate || !userJson) throw new UnauthorizedException('TELEGRAM_INVALID');
    if (!Number.isSafeInteger(Number(authDate)) || (now.getTime() / 1000) - Number(authDate) > 86_400) {
      throw new UnauthorizedException('TELEGRAM_INVALID');
    }

    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expectedHash = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(receivedHash, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('TELEGRAM_INVALID');
    }

    const parsed: unknown = JSON.parse(userJson);
    if (!parsed || typeof parsed !== 'object' || !('id' in parsed) || typeof parsed.id !== 'number') {
      throw new UnauthorizedException('TELEGRAM_INVALID');
    }
    const user = parsed as {
      id: number;
      username?: unknown;
      first_name?: unknown;
      last_name?: unknown;
      photo_url?: unknown;
    };
    return {
      id: String(user.id),
      username: typeof user.username === 'string' ? user.username : undefined,
      firstName: typeof user.first_name === 'string' ? user.first_name : undefined,
      lastName: typeof user.last_name === 'string' ? user.last_name : undefined,
      photoUrl: typeof user.photo_url === 'string' ? user.photo_url : undefined,
    };
  }
}
