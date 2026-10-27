// Answers of the public server actions (kept outside the 'use server' files, which may only
// export functions).

export type RevealState =
  | null
  | { phone: string }
  | {
      /** A key of publicProfile.reveal.errors. */
      error: string;
      minutes?: number;
      /** Show the Turnstile widget before the next try. */
      needsCaptcha?: boolean;
      /** Different for every answer: the widget asks for a fresh token when it changes. */
      nonce?: string;
    };

export type ReportState =
  | null
  | { sent: true }
  /** A key of publicProfile.report.errors. */
  | { error: string };
