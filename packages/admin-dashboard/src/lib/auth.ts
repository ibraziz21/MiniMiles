import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions } from "./session";
import { supabase } from "./supabase";
import type { AdminSessionData, AdminRole } from "@/types";
import { hasPermission } from "@/types";
import { getAdminSettings } from "./adminSettings";

export function isOpenAccessMode(): boolean {
  if (process.env.ADMIN_OPEN_ACCESS === "true") return true;
  if (process.env.ADMIN_OPEN_ACCESS === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function getOpenAccessSession(): AdminSessionData {
  return {
    adminUserId: "00000000-0000-0000-0000-000000000000",
    email: "open-access@akibamiles.local",
    name: "Open Access",
    role: "super_admin",
    mustChangePassword: false,
    issuedAt: Date.now(),
    openAccess: true,
  };
}

export function adminIdForWrite(session: AdminSessionData): string | null {
  return session.openAccess ? null : session.adminUserId;
}

// ── Session helpers ───────────────────────────────────────────────────────────

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<AdminSessionData>(cookieStore, sessionOptions);
}

export async function requireAdminSession(
  requiredPermission?: string,
): Promise<AdminSessionData | null> {
  if (isOpenAccessMode()) {
    return getOpenAccessSession();
  }

  const session = await getSession();
  if (!session.adminUserId) return null;

  const settings = await getAdminSettings();
  const sessionAgeMs = Date.now() - (session.issuedAt ?? 0);
  if (sessionAgeMs > settings.security.sessionTimeoutMinutes * 60 * 1000) {
    session.destroy();
    return null;
  }

  const { data: user } = await supabase
    .from("admin_users")
    .select("email, name, is_active, role, must_change_password")
    .eq("id", session.adminUserId)
    .single();

  if (!user || !user.is_active) return null;

  session.email = user.email;
  session.name = user.name ?? null;
  session.role = user.role;
  session.mustChangePassword = Boolean(user.must_change_password);

  if (requiredPermission && !hasPermission(session.role, requiredPermission)) {
    return null;
  }

  return session;
}

// ── Password utils ────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

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

  if (actualHash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

// ── Login rate limit ──────────────────────────────────────────────────────────

export async function checkLoginRateLimit(
  email: string,
): Promise<{ allowed: boolean; retryAfter: Date }> {
  const { data } = await supabase
    .from("admin_login_attempts")
    .select("failure_count, locked_until")
    .eq("email", email.toLowerCase())
    .single();

  if (!data) return { allowed: true, retryAfter: new Date() };

  if (data.locked_until && new Date(data.locked_until) > new Date()) {
    return { allowed: false, retryAfter: new Date(data.locked_until) };
  }

  return { allowed: true, retryAfter: new Date() };
}

export async function recordLoginFailure(email: string): Promise<void> {
  const key = email.toLowerCase();
  const settings = await getAdminSettings();
  const { data } = await supabase
    .from("admin_login_attempts")
    .select("failure_count")
    .eq("email", key)
    .single();

  const count = (data?.failure_count ?? 0) + 1;
  const lockedUntil =
    count >= settings.security.loginLockoutMaxFailures
      ? new Date(Date.now() + settings.security.loginLockoutMinutes * 60 * 1000).toISOString()
      : null;

  await supabase.from("admin_login_attempts").upsert(
    { email: key, failure_count: count, locked_until: lockedUntil, last_attempt: new Date().toISOString() },
    { onConflict: "email" },
  );
}

export async function recordLoginSuccess(email: string): Promise<void> {
  await supabase
    .from("admin_login_attempts")
    .delete()
    .eq("email", email.toLowerCase());
}
