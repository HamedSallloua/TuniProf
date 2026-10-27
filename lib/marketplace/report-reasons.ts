// The reasons offered by "Signaler ce profil" (spec 3.4). In their own small file because the
// report form (browser code) needs the list but not the database code of reports.ts.

export const REPORT_REASONS = [
  'wrong_info',
  'inappropriate',
  'suspected_fraud',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
