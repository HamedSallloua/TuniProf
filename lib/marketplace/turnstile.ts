import { getTurnstileConfig } from '@/lib/env';

// Server-side check of a Cloudflare Turnstile answer (spec 3.4). The page shows the widget,
// the widget gives a one-time token, and this asks Cloudflare whether the token is genuine.

export type TurnstileVerifier = (
  token: string,
  remoteIp?: string | null,
) => Promise<boolean>;

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const verifyTurnstile: TurnstileVerifier = async (token, remoteIp) => {
  const config = getTurnstileConfig();
  if (!config || !token || token.length > 2048) return false;

  const body = new URLSearchParams({
    secret: config.secretKey,
    response: token,
  });
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    // Cloudflare unreachable: the check fails closed, the visitor can try again.
    return false;
  }
};
