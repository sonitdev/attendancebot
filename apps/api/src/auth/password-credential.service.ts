import { Injectable } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

@Injectable()
export class PasswordCredentialService {
  hash(password: string): string {
    const salt = randomBytes(16);
    const derived = scryptSync(password, salt, 64);
    return `scrypt:${salt.toString('base64url')}:${derived.toString('base64url')}`;
  }

  verify(password: string, stored: string | null | undefined): boolean {
    if (!stored) return false;
    const [algorithm, saltValue, hashValue] = stored.split(':');
    if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
    try {
      const expected = Buffer.from(hashValue, 'base64url');
      const actual = scryptSync(password, Buffer.from(saltValue, 'base64url'), expected.length);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
}
