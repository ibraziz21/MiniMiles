import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decryptCompletionContact,
  encryptCompletionContact,
  isContactEncryptionConfigured,
} from "@/lib/akiba/accountDeletionContact";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("completion-contact encryption", () => {
  beforeEach(() => {
    process.env.ACCOUNT_DELETION_CONTACT_KEY_V1 = KEY;
  });

  afterEach(() => {
    delete process.env.ACCOUNT_DELETION_CONTACT_KEY_V1;
  });

  it("round-trips the address under the configured key", () => {
    const encrypted = encryptCompletionContact("member@example.com");
    expect(encrypted).not.toBeNull();
    expect(encrypted!.keyVersion).toBe("v1");
    expect(decryptCompletionContact(encrypted!.ciphertext, encrypted!.keyVersion)).toBe(
      "member@example.com",
    );
  });

  it("never stores the address in readable form", () => {
    const encrypted = encryptCompletionContact("member@example.com");
    expect(encrypted!.ciphertext).toMatch(/^\\x[0-9a-f]+$/);
    expect(encrypted!.ciphertext).not.toContain("member");
    expect(Buffer.from(encrypted!.ciphertext.slice(2), "hex").toString("utf8")).not.toContain(
      "member@example.com",
    );
  });

  it("produces a different ciphertext each time for the same address", () => {
    // A deterministic ciphertext would let anyone with table access confirm
    // whether a known address belongs to a given request.
    const first = encryptCompletionContact("member@example.com");
    const second = encryptCompletionContact("member@example.com");
    expect(first!.ciphertext).not.toBe(second!.ciphertext);
  });

  it("refuses to decrypt a tampered ciphertext", () => {
    const encrypted = encryptCompletionContact("member@example.com")!;
    const bytes = Buffer.from(encrypted.ciphertext.slice(2), "hex");
    bytes[bytes.length - 1] ^= 0xff;
    expect(decryptCompletionContact(`\\x${bytes.toString("hex")}`, "v1")).toBeNull();
  });

  it("returns null rather than plaintext when no key is configured", () => {
    delete process.env.ACCOUNT_DELETION_CONTACT_KEY_V1;
    expect(isContactEncryptionConfigured()).toBe(false);
    expect(encryptCompletionContact("member@example.com")).toBeNull();
  });

  it("rejects a key of the wrong length instead of deriving one", () => {
    process.env.ACCOUNT_DELETION_CONTACT_KEY_V1 = Buffer.alloc(16, 1).toString("base64");
    expect(isContactEncryptionConfigured()).toBe(false);
    expect(encryptCompletionContact("member@example.com")).toBeNull();
  });

  it("returns null for an unknown key version", () => {
    const encrypted = encryptCompletionContact("member@example.com")!;
    expect(decryptCompletionContact(encrypted.ciphertext, "v9")).toBeNull();
  });

  it("handles missing or malformed stored values", () => {
    expect(decryptCompletionContact(null, "v1")).toBeNull();
    expect(decryptCompletionContact("\\xzz", "v1")).toBeNull();
    expect(decryptCompletionContact("\\x00", "v1")).toBeNull();
  });
});
