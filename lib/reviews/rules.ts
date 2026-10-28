import { z } from 'zod';

// The content rules of reviews and replies (spec 3.5). Plain code without any database import,
// so the forms (browser code) can use the lists and the limits too.

export const COMMENT_MAX = 500;
export const REPLY_MAX = 500;

// A rolling 24 hours, enforced by the database too (migration 0014).
export const REVIEWS_PER_DAY = 3;

/** The reasons a teacher can give when reporting a review. */
export const REVIEW_REPORT_REASONS = [
  'inappropriate',
  'fake_review',
  'other',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value));

const reviewSchema = z.object({
  // A form sends text: "4" is accepted, "4.5" and "0" are not.
  rating: z.coerce.number().int().min(1).max(5),
  comment: optionalText(COMMENT_MAX),
});

export type ReviewInput = { rating: number; comment: string | null };

export function parseReviewInput(raw: {
  rating: unknown;
  comment: unknown;
}): ReviewInput | null {
  const parsed = reviewSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** A reply cannot be empty. Returns the trimmed text, or null when it is not acceptable. */
export function parseReply(text: unknown): string | null {
  const parsed = z.string().trim().min(1).max(REPLY_MAX).safeParse(text);
  return parsed.success ? parsed.data : null;
}

const reportSchema = z
  .object({
    reason: z.enum(REVIEW_REPORT_REASONS),
    note: optionalText(500),
  })
  .refine((value) => value.reason !== 'other' || value.note !== null, {
    path: ['note'],
  });

export function parseReviewReport(raw: {
  reason: unknown;
  note: unknown;
}): { reason: ReviewReportReason; note: string | null } | null {
  const parsed = reportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
