export const EVIDENCE_BUCKET = "voucher-reimbursement-evidence";
export function evidenceExtension(
  bytes: Uint8Array,
  type: string
): string | null {
  if (
    type === "application/pdf" &&
    String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-"
  )
    return "pdf";
  if (
    type === "image/png" &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    return "png";
  if (
    type === "image/jpeg" &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "jpg";
  return null;
}
