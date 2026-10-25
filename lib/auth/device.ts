import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_S } from './config';
import { hmac } from './crypto';
import type { DeviceContext } from './verification';

// "Device" = an anonymous random cookie, plus a hash of the network address.
// Used for rate limits and to make sure only the browser that started a WhatsApp
// verification can finish it. Mobile networks share addresses between many people,
// so the cookie is the main signal and the address only has a higher limit.

async function ipHash(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || h.get('x-real-ip');
  return ip ? hmac('ip', ip) : null;
}

/**
 * The current browser. With `create: true` (server actions only) a missing cookie is
 * created. Without it, a browser with no cookie gets null.
 */
export async function getDeviceContext(options: {
  create: boolean;
}): Promise<DeviceContext | null> {
  const store = await cookies();
  let raw = store.get(DEVICE_COOKIE)?.value;

  if (!raw || raw.length < 20) {
    if (!options.create) return null;
    raw = randomBytes(24).toString('base64url');
    store.set(DEVICE_COOKIE, raw, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: DEVICE_COOKIE_MAX_AGE_S,
    });
  }
  return { deviceHash: hmac('device', raw), ipHash: await ipHash() };
}
