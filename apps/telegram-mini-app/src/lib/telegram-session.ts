import type { TelegramSessionResponse } from '@workforce/contracts';
import type { TelegramWebApp } from '../types/telegram';
import { api } from './api';

/** The SDK is asynchronous so a slow Telegram CDN cannot block first paint. */
export async function waitForTelegram(): Promise<TelegramWebApp> {
  const deadline = Date.now() + 8_000;
  while (!window.Telegram?.WebApp) {
    if (Date.now() >= deadline) throw new Error('TELEGRAM_SDK_UNAVAILABLE');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return window.Telegram.WebApp;
}

let inFlight: { initData: string; promise: Promise<TelegramSessionResponse> } | undefined;
let cached: { initData: string; response: TelegramSessionResponse; expiresAt: number } | undefined;

/** Deduplicate concurrent mounts and cache fresh session for 30s to prevent duplicate network requests. */
export function createVerifiedSession(initData: string): Promise<TelegramSessionResponse> {
  const now = Date.now();
  if (cached && cached.initData === initData && cached.expiresAt > now) {
    return Promise.resolve(cached.response);
  }

  if (inFlight?.initData === initData) {
    return inFlight.promise;
  }

  const promise = api
    .createSession(initData)
    .then((res) => {
      const ttlMs = Math.min(30_000, new Date(res.expiresAt).getTime() - now - 10_000);
      if (ttlMs > 0) {
        cached = { initData, response: res, expiresAt: now + ttlMs };
      }
      return res;
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = undefined;
    });

  inFlight = { initData, promise };
  return promise;
}
