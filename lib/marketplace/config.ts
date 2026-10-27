// Every limit of the public marketplace, in one place.

const HOUR = 60 * 60 * 1000;

// Contact reveal (spec 3.4, acceptance test 14). "Device" = anonymous cookie; the address
// limit is much higher because mobile networks share one address between many people.
export const REVEAL_LIMITS = {
  windowMs: HOUR,
  perDevice: 30, // the 31st reveal in an hour is blocked
  turnstileAfter: 10, // from the 11th reveal in an hour a Turnstile check is required
  perIp: 300,
} as const;

// "Signaler ce profil": a few reports per hour is plenty for a real person.
export const REPORT_LIMITS = {
  windowMs: HOUR,
  perDevice: 5,
  perIp: 30,
} as const;

export const SEARCH = {
  pageSize: 20,
  // Teachers whose score differs by less than this many points (out of 100) count as equal
  // and are shown in a rotating order (spec 3.2).
  rotationBand: 5,
  // The ranking runs in the application on the matching teachers; this is only a safety net.
  maxCandidates: 5000,
  // How long one rotation lasts, so pages of the same search stay consistent while browsing.
  rotationMs: HOUR,
} as const;

// Score weights, out of 100 (spec 3.2: "completeness + rating + renewal recency").
export const RANKING_WEIGHTS = {
  completeness: 40,
  rating: 40,
  recency: 20,
} as const;
