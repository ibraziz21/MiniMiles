/**
 * Member-facing reasons for reporting a verified visit.
 *
 * Mirrors VERIFIED_VISIT_REPORT_REASONS in hub-page's
 * src/lib/merchants/verifiedVisitReports.ts and the CHECK constraint in
 * supabase/migrations/104_verified_visit_reports.sql — keep all three in
 * sync. The app cannot import from hub-page, so this is a deliberate copy of
 * the values rather than a shared module; `verified-visit-report.test.ts`
 * pins them so a drift shows up as a failing test rather than a 400 on a
 * real device.
 *
 * Bounded rather than free text: it keeps reports countable, and a comment
 * box is a reliable way for someone to put personal data into a moderation
 * queue.
 */
export const VERIFIED_VISIT_REPORT_REASONS = [
  { value: 'offensive', label: 'Hateful or abusive' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or harm' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'shows_a_person', label: 'Shows someone identifiable' },
  { value: 'personal_information', label: 'Shows personal information' },
  { value: 'not_this_place', label: 'Not about this place' },
  { value: 'other', label: 'Something else' },
] as const;

export type VerifiedVisitReportReason = (typeof VERIFIED_VISIT_REPORT_REASONS)[number]['value'];

export function isVerifiedVisitReportReason(value: unknown): value is VerifiedVisitReportReason {
  return VERIFIED_VISIT_REPORT_REASONS.some((reason) => reason.value === value);
}
