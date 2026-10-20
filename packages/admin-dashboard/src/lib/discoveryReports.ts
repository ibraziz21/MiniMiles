export const REPORT_REASONS: Record<string, string> = {
  offensive: "Hateful or abusive", sexual_content: "Sexual content", violence: "Violence or harm",
  spam: "Spam or advertising", shows_a_person: "Identifiable person",
  personal_information: "Personal information", not_this_place: "Not about this place", other: "Something else",
};
export const RESOLUTION_REASONS = {
  hide_photo: ["policy_violation", "identifiable_person", "not_merchant_related", "receipt_or_personal_info", "other"],
  hide_visit: ["policy_violation", "identifiable_person", "not_merchant_related", "receipt_or_personal_info", "other"],
  dismiss: ["no_violation", "insufficient_evidence", "already_handled"],
} as const;
export type ReportAction = keyof typeof RESOLUTION_REASONS;
export function isReportResolution(action: unknown, reason: unknown): action is ReportAction {
  return typeof action === "string" && Object.hasOwn(RESOLUTION_REASONS, action) &&
    typeof reason === "string" && (RESOLUTION_REASONS[action as ReportAction] as readonly string[]).includes(reason);
}
