import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TelegramInitDataVerifier } from '../src/telegram/telegram-init-data.verifier.js';

function generateInitData(
  botToken: string,
  user: { id: number; first_name?: string; last_name?: string; username?: string },
  authDate = Math.floor(Date.now() / 1000),
  extraParams: Record<string, string> = {},
): string {
  const params: Record<string, string> = {
    auth_date: String(authDate),
    query_id: 'AAHdF6IQAAAAAN0XohD9Kq4-',
    user: JSON.stringify(user),
    ...extraParams,
  };

  const dataCheckString = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const searchParams = new URLSearchParams(params);
  searchParams.set('hash', hash);
  return searchParams.toString();
}

describe('TelegramInitDataVerifier', () => {
  const verifier = new TelegramInitDataVerifier();
  const botToken = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ';

  it('successfully verifies authentic initData and returns user information including avatar photo', () => {
    const initData = generateInitData(botToken, {
      id: 987654321,
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
      photo_url: 'https://t.me/i/userpic/320/johndoe.jpg',
    });

    const user = verifier.verify(initData, botToken);
    expect(user).toEqual({
      id: '987654321',
      firstName: 'John',
      lastName: 'Doe',
      username: 'johndoe',
      photoUrl: 'https://t.me/i/userpic/320/johndoe.jpg',
    });
  });

  it('rejects stale initData older than 24 hours (86,400 seconds)', () => {
    const staleAuthDate = Math.floor(Date.now() / 1000) - 86_500;
    const initData = generateInitData(botToken, { id: 12345 }, staleAuthDate);

    expect(() => verifier.verify(initData, botToken)).toThrow(UnauthorizedException);
    expect(() => verifier.verify(initData, botToken)).toThrow('TELEGRAM_INVALID');
  });

  it('rejects initData when hash is forged or tampered with', () => {
    const validInitData = generateInitData(botToken, { id: 12345 });
    const params = new URLSearchParams(validInitData);
    params.set('hash', 'deadbeef00000000000000000000000000000000000000000000000000000000');

    expect(() => verifier.verify(params.toString(), botToken)).toThrow(UnauthorizedException);
    expect(() => verifier.verify(params.toString(), botToken)).toThrow('TELEGRAM_INVALID');
  });

  it('rejects initData when user data has been modified without re-signing', () => {
    const validInitData = generateInitData(botToken, { id: 12345, first_name: 'Original' });
    const params = new URLSearchParams(validInitData);
    params.set('user', JSON.stringify({ id: 99999, first_name: 'Attacker' }));

    expect(() => verifier.verify(params.toString(), botToken)).toThrow(UnauthorizedException);
    expect(() => verifier.verify(params.toString(), botToken)).toThrow('TELEGRAM_INVALID');
  });

  it('rejects initData validated against the wrong bot token', () => {
    const initData = generateInitData(botToken, { id: 12345 });
    const wrongBotToken = '987654321:XYZ-different-token';

    expect(() => verifier.verify(initData, wrongBotToken)).toThrow(UnauthorizedException);
    expect(() => verifier.verify(initData, wrongBotToken)).toThrow('TELEGRAM_INVALID');
  });

  it('rejects initData missing hash', () => {
    const params = new URLSearchParams({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 12345 }),
    });

    expect(() => verifier.verify(params.toString(), botToken)).toThrow(UnauthorizedException);
  });

  it('rejects initData missing auth_date', () => {
    const params = new URLSearchParams({
      hash: 'somehash',
      user: JSON.stringify({ id: 12345 }),
    });

    expect(() => verifier.verify(params.toString(), botToken)).toThrow(UnauthorizedException);
  });

  it('rejects initData missing user field', () => {
    const params = new URLSearchParams({
      hash: 'somehash',
      auth_date: String(Math.floor(Date.now() / 1000)),
    });

    expect(() => verifier.verify(params.toString(), botToken)).toThrow(UnauthorizedException);
  });

  it('rejects initData with malformed user json', () => {
    const initData = generateInitData(botToken, { id: 12345 });
    const params = new URLSearchParams(initData);
    params.set('user', 'not-valid-json');

    expect(() => verifier.verify(params.toString(), botToken)).toThrow(UnauthorizedException);
  });
});
