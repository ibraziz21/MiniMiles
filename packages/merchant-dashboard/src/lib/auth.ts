import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions } from "./session";
import type { MerchantSessionData } from "@/types";

// ── Session helpers ───────────────────────────────────────────────────────────

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<MerchantSessionData>(cookieStore, sessionOptions);
}

/**
 * Returns the authenticated merchant session, or null.
 * Use this in every protected API route.
 */
export async function requireMerchantSession(): Promise<MerchantSessionData | null> {
  const session = await getSession();
  if (!session.merchantUserId || !session.partnerId) return null;
  return {
    merchantUserId: session.merchantUserId,
    email: session.email,
    partnerId: session.partnerId,
    partnerName: session.partnerName,
    role: session.role ?? "staff",
    issuedAt: session.issuedAt,
  };
}

// ── Password utils ────────────────────────────────────────────────────────────
// Simple bcrypt-style hashing using the Web Crypto API (no native deps).

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );

  const hashHex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, expectedHash] = stored.split(":");
  if (!saltHex || !expectedHash) return false;

  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );

  const actualHash = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (actualHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}
