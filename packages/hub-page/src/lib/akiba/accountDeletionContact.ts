/**
 * Purpose-limited encryption for the one contact value account deletion has
 * to outlive the member's own record: the address the completion email goes
 * to (AKIBA-MOB-002 §8.1, §8.2 steps 10 and 14).
 *
 * AES-256-GCM under a versioned key held only in server environment config.
 * The key version travels with the ciphertext so a rotation can decrypt old
 * rows without re-encrypting them, and support roles reading the table see
 * bytes rather than an email address.
 *
 * When no key is configured the functions return null rather than storing
 * plaintext. The practical effect is that deletion still completes and the
 * completion email is recorded as undeliverable — which is the correct
 * failure direction for a destructive, legally required workflow.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const CONTACT_KEY_VERSION = "v1";

export type EncryptedContact = {
  /** PostgREST bytea literal, e.g. `\x8f1a…`. */
  ciphertext: string;
  keyVersion: string;
};

function resolveKey(version: string): Buffer | null {
  const raw = version === CONTACT_KEY_VERSION
    ? process.env.ACCOUNT_DELETION_CONTACT_KEY_V1
    : undefined;
  if (!raw?.trim()) return null;

  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    console.error(
      `[accountDeletionContact] ACCOUNT_DELETION_CONTACT_KEY_${version.toUpperCase()} must decode to 32 bytes`,
    );
    return null;
  }
  return key;
}

function toByteaLiteral(buffer: Buffer): string {
  return `\\x${buffer.toString("hex")}`;
}

function fromByteaLiteral(value: string): Buffer | null {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  return Buffer.from(hex, "hex");
}

export function isContactEncryptionConfigured(): boolean {
  return resolveKey(CONTACT_KEY_VERSION) !== null;
}

export function encryptCompletionContact(contact: string): EncryptedContact | null {
  const key = resolveKey(CONTACT_KEY_VERSION);
  if (!key || !contact.trim()) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(contact.trim(), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: toByteaLiteral(Buffer.concat([iv, tag, encrypted])),
    keyVersion: CONTACT_KEY_VERSION,
  };
}

/** Returns null for a missing key, wrong version, or tampered ciphertext. */
export function decryptCompletionContact(
  ciphertext: string | null | undefined,
  keyVersion: string | null | undefined,
): string | null {
  if (!ciphertext || !keyVersion) return null;
  const key = resolveKey(keyVersion);
  if (!key) return null;

  const payload = fromByteaLiteral(ciphertext);
  if (!payload || payload.length <= IV_BYTES + TAG_BYTES) return null;

  try {
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const body = payload.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    // Authentication failure is the expected path for a tampered or
    // wrong-key row. Never surface the reason.
    return null;
  }
}
