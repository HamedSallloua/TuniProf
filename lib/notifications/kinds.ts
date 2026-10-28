// The events that produce a message (spec 9) and the channels each one uses.

export const NOTIFICATION_KINDS = [
  'profile_approved',
  'profile_rejected',
  'version_approved',
  'version_rejected',
  'payment_proof_received',
  'code_issued',
  'payment_refused',
  'plan_expiring',
  'plan_expired',
  'grace_ending',
  'review_published',
  'review_report_outcome',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type Channel = 'site' | 'whatsapp' | 'email';

// Spec 9, with the owner's ruling for warnings (M0): every channel.
//  - profile and payment events: WhatsApp (copy-paste) and the on-site notice, plus e-mail when
//    the teacher gave an address;
//  - expiry reminders and grace-period warnings: on-site, e-mail, WhatsApp;
//  - a new review and a report outcome: on-site only.
const ALL: readonly Channel[] = ['site', 'whatsapp', 'email'];
const SITE_ONLY: readonly Channel[] = ['site'];
const SITE_AND_WHATSAPP: readonly Channel[] = ['site', 'whatsapp'];

export const CHANNELS_BY_KIND: Record<NotificationKind, readonly Channel[]> = {
  profile_approved: ALL,
  profile_rejected: ALL,
  version_approved: ALL,
  version_rejected: ALL,
  payment_proof_received: SITE_AND_WHATSAPP,
  code_issued: SITE_AND_WHATSAPP,
  payment_refused: SITE_AND_WHATSAPP,
  plan_expiring: ALL,
  plan_expired: ALL,
  grace_ending: ALL,
  review_published: SITE_ONLY,
  review_report_outcome: SITE_ONLY,
};

/** Values written into the text. Dates are ISO strings, shown in Africa/Tunis. */
export type NotificationParams = Record<string, string | number | null>;
