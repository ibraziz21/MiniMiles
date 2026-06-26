const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Cryptographically secure voucher code — 10 characters, ~51 bits of entropy. */
export function generateSecureCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join("");
}

/** Canonical signed message for Hub wallet-based issuance. */
export function buildIssueMessage(params: {
  templateId: string;
  address: string;
  nonce: string;
  timestamp: number;
}): string {
  return (
    `Akiba Hub: Issue voucher ${params.templateId}` +
    `\nAddress: ${params.address.toLowerCase()}` +
    `\nNonce: ${params.nonce}` +
    `\nTimestamp: ${params.timestamp}`
  );
}

/** Timestamp must be within 10 minutes of server time. */
export const NONCE_WINDOW_SEC = 600;

export function isTimestampFresh(timestamp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestamp) <= NONCE_WINDOW_SEC;
}
