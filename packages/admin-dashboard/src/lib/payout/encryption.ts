// AES-256-GCM encryption for sensitive payout destination fields.
// Key must be 32-byte hex string in PAYOUT_ENCRYPTION_KEY env var.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const KEY_HEX = process.env.PAYOUT_ENCRYPTION_KEY ?? "";

export function encryptDestinationDetails(
  plaintext: Record<string, string>,
): { iv: string; tag: string; ciphertext: string } {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error("PAYOUT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  const key = Buffer.from(KEY_HEX, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = JSON.stringify(plaintext);
  const ciphertext = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export function decryptDestinationDetails(encrypted: {
  iv: string;
  tag: string;
  ciphertext: string;
}): Record<string, string> {
  if (!KEY_HEX || KEY_HEX.length !== 64) throw new Error("PAYOUT_ENCRYPTION_KEY not configured");
  const key = Buffer.from(KEY_HEX, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "hex"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

export function redactDestination(type: string, details: Record<string, string>): string {
  switch (type) {
    case "mpesa": {
      const phone = details.phone ?? "";
      return `M-Pesa ...${phone.slice(-4)}`;
    }
    case "bank":
      return `${details.bank_name ?? "Bank"} ...${(details.account_number ?? "").slice(-4)}`;
    case "celo_wallet":
      return `Celo ${(details.address ?? "").slice(0, 6)}...${(details.address ?? "").slice(-4)}`;
    case "manual":
      return details.description ?? "Manual";
    default:
      return "Unknown";
  }
}
