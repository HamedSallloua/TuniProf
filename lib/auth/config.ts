// Every limit of the accounts module, in one place.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const OTP_TTL_MS = 5 * MINUTE; // a code is valid 5 minutes (spec 8.5)
export const OTP_MAX_ATTEMPTS = 5; // wrong tries before the lock (spec 8.5)
export const OTP_LOCK_MS = HOUR; // lock length after 5 wrong tries (test 21)

// How long a session lasts. Visitors (reviewers) have no password, so theirs is short:
// they prove their phone again on WhatsApp for each new session (owner decision).
export const SESSION_TTL_MS = {
  teacher: 30 * DAY,
  visitor: DAY,
  admin_super: 12 * HOUR,
  admin_support: 12 * HOUR,
} as const;

// Sliding windows. "device" = anonymous cookie, "ip" = hashed address (shared by many
// users on mobile networks, so its limit is higher).
export const RATE_LIMITS = {
  // Starting a WhatsApp verification (signup, reset, reviewer login)
  challenge: {
    windowMs: HOUR,
    perPhone: 5,
    perDevice: 10,
    perIp: 30,
  },
  // Wrong password at login
  loginFailure: {
    windowMs: HOUR,
    perPhone: 10,
    perDevice: 20,
    perIp: 60,
  },
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const SESSION_COOKIE = 'tp_session';
export const DEVICE_COOKIE = 'tp_device';
// Where a reviewer goes back to after the WhatsApp sign-in (a /prof/... address, 30 minutes).
export const RETURN_COOKIE = 'tp_return';
export const RETURN_COOKIE_MAX_AGE_S = 30 * 60;
export const DEVICE_COOKIE_MAX_AGE_S = 2 * 365 * 24 * 60 * 60;
