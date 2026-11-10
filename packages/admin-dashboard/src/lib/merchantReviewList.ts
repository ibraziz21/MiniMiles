export type MerchantReviewRow = {
  id: string;
  name: string;
  location: string;
  status: string;
  submittedAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
};
export function reviewKind(
  row: Pick<MerchantReviewRow, "publishedAt">
): "new" | "updates" {
  return row.publishedAt ? "updates" : "new";
}
export function reviewListFilters(
  rows: MerchantReviewRow[],
  query: string,
  kind: string
) {
  const q = query.trim().toLowerCase();
  return rows
    .filter(
      (row) =>
        row.status === "pending_review" &&
        ((kind !== "new" && kind !== "updates") || reviewKind(row) === kind) &&
        `${row.name} ${row.location}`.toLowerCase().includes(q)
    )
    .sort((a, b) =>
      (a.submittedAt ?? a.updatedAt ?? "").localeCompare(
        b.submittedAt ?? b.updatedAt ?? ""
      )
    );
}
