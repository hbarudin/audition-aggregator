import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

export const ADMIN_COOKIE = 'admin_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: MAX_AGE,
} as const;

// The cookie carries an HMAC of a fixed label rather than ADMIN_KEY itself, so
// a stolen cookie never hands over the key.
function sessionToken(): string | null {
  const key = process.env.ADMIN_KEY;
  if (!key) return null;
  return createHmac('sha256', key).update('admin-session-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so that has to be checked first;
  // the length of a secret is not the part worth hiding.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Returns the session token to store, or null if the key is wrong. */
export function verifyAdminKey(candidate: string): string | null {
  const key = process.env.ADMIN_KEY;
  if (!key || !candidate) return null;
  return safeEqual(candidate, key) ? sessionToken() : null;
}

export async function isAdmin(): Promise<boolean> {
  const expected = sessionToken();
  if (!expected) return false;
  const cookie = (await cookies()).get(ADMIN_COOKIE)?.value;
  return !!cookie && safeEqual(cookie, expected);
}

/**
 * Only allow redirects back to a path on this site — never a protocol-relative
 * or absolute URL, which would turn the login form into an open redirect.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string') return '/theaters';
  if (!next.startsWith('/') || next.startsWith('//')) return '/theaters';
  return next;
}
