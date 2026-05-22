import { supabase } from "./supabase";

export const PAYOUT_METHODS = ["wallet", "bank", "mpesa"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export type SecuritySettings = {
  passwordMinLength: number;
  sessionTimeoutMinutes: number;
  loginLockoutMaxFailures: number;
  loginLockoutMinutes: number;
  requireTempPasswordReset: boolean;
};

export type FinanceSettings = {
  receiptPrefix: string;
  payoutApprovalThreshold: number;
  enabledPayoutMethods: PayoutMethod[];
  requireTxHashForWallet: boolean;
  businessName: string;
  businessEmail: string;
  businessPhone: string;
  businessAddress: string;
};

export type NotificationSettings = {
  financeAlertEmail: string;
  opsAlertEmail: string;
  supportEmail: string;
};

export type AdminSettings = {
  security: SecuritySettings;
  finance: FinanceSettings;
  notifications: NotificationSettings;
};

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  security: {
    passwordMinLength: 12,
    sessionTimeoutMinutes: 480,
    loginLockoutMaxFailures: 5,
    loginLockoutMinutes: 15,
    requireTempPasswordReset: true,
  },
  finance: {
    receiptPrefix: "AKB-RCPT",
    payoutApprovalThreshold: 0,
    enabledPayoutMethods: ["wallet", "bank", "mpesa"],
    requireTxHashForWallet: true,
    businessName: "AkibaMiles",
    businessEmail: "",
    businessPhone: "",
    businessAddress: "",
  },
  notifications: {
    financeAlertEmail: "",
    opsAlertEmail: "",
    supportEmail: "",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback: string, maxLength = 160) {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function asMoney(value: unknown, fallback: number) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.round(num * 100) / 100;
}

function normalizeEmail(value: unknown, fallback: string) {
  const email = asString(value, fallback, 254).toLowerCase();
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid email address: ${email}`);
  }
  return email;
}

function normalizePayoutMethods(value: unknown): PayoutMethod[] {
  const raw = Array.isArray(value) ? value : DEFAULT_ADMIN_SETTINGS.finance.enabledPayoutMethods;
  const methods = raw.filter((method): method is PayoutMethod =>
    typeof method === "string" && (PAYOUT_METHODS as readonly string[]).includes(method),
  );
  return methods.length > 0 ? [...new Set(methods)] : DEFAULT_ADMIN_SETTINGS.finance.enabledPayoutMethods;
}

export function normalizeAdminSettings(input: unknown): AdminSettings {
  const root = isRecord(input) ? input : {};
  const security = isRecord(root.security) ? root.security : {};
  const finance = isRecord(root.finance) ? root.finance : {};
  const notifications = isRecord(root.notifications) ? root.notifications : {};

  return {
    security: {
      passwordMinLength: asInt(
        security.passwordMinLength,
        DEFAULT_ADMIN_SETTINGS.security.passwordMinLength,
        10,
        128,
      ),
      sessionTimeoutMinutes: asInt(
        security.sessionTimeoutMinutes,
        DEFAULT_ADMIN_SETTINGS.security.sessionTimeoutMinutes,
        15,
        1440,
      ),
      loginLockoutMaxFailures: asInt(
        security.loginLockoutMaxFailures,
        DEFAULT_ADMIN_SETTINGS.security.loginLockoutMaxFailures,
        3,
        20,
      ),
      loginLockoutMinutes: asInt(
        security.loginLockoutMinutes,
        DEFAULT_ADMIN_SETTINGS.security.loginLockoutMinutes,
        5,
        1440,
      ),
      requireTempPasswordReset: asBoolean(
        security.requireTempPasswordReset,
        DEFAULT_ADMIN_SETTINGS.security.requireTempPasswordReset,
      ),
    },
    finance: {
      receiptPrefix: asString(finance.receiptPrefix, DEFAULT_ADMIN_SETTINGS.finance.receiptPrefix, 32),
      payoutApprovalThreshold: asMoney(
        finance.payoutApprovalThreshold,
        DEFAULT_ADMIN_SETTINGS.finance.payoutApprovalThreshold,
      ),
      enabledPayoutMethods: normalizePayoutMethods(finance.enabledPayoutMethods),
      requireTxHashForWallet: asBoolean(
        finance.requireTxHashForWallet,
        DEFAULT_ADMIN_SETTINGS.finance.requireTxHashForWallet,
      ),
      businessName: asString(finance.businessName, DEFAULT_ADMIN_SETTINGS.finance.businessName, 120),
      businessEmail: normalizeEmail(finance.businessEmail, DEFAULT_ADMIN_SETTINGS.finance.businessEmail),
      businessPhone: asString(finance.businessPhone, DEFAULT_ADMIN_SETTINGS.finance.businessPhone, 80),
      businessAddress: asString(finance.businessAddress, DEFAULT_ADMIN_SETTINGS.finance.businessAddress, 240),
    },
    notifications: {
      financeAlertEmail: normalizeEmail(
        notifications.financeAlertEmail,
        DEFAULT_ADMIN_SETTINGS.notifications.financeAlertEmail,
      ),
      opsAlertEmail: normalizeEmail(
        notifications.opsAlertEmail,
        DEFAULT_ADMIN_SETTINGS.notifications.opsAlertEmail,
      ),
      supportEmail: normalizeEmail(
        notifications.supportEmail,
        DEFAULT_ADMIN_SETTINGS.notifications.supportEmail,
      ),
    },
  };
}

export async function getAdminSettings(): Promise<AdminSettings> {
  const { data, error } = await supabase
    .from("admin_settings")
    .select("key, value")
    .in("key", ["security", "finance", "notifications"]);

  if (error) {
    console.error("[admin-settings] read error:", error.message);
    return DEFAULT_ADMIN_SETTINGS;
  }

  const merged: AdminSettings = {
    security: { ...DEFAULT_ADMIN_SETTINGS.security },
    finance: { ...DEFAULT_ADMIN_SETTINGS.finance },
    notifications: { ...DEFAULT_ADMIN_SETTINGS.notifications },
  };

  for (const row of data ?? []) {
    if (row.key === "security" && isRecord(row.value)) {
      merged.security = { ...merged.security, ...row.value };
    }
    if (row.key === "finance" && isRecord(row.value)) {
      merged.finance = { ...merged.finance, ...row.value };
    }
    if (row.key === "notifications" && isRecord(row.value)) {
      merged.notifications = { ...merged.notifications, ...row.value };
    }
  }

  return normalizeAdminSettings(merged);
}

export async function saveAdminSettings(settings: AdminSettings, updatedBy: string | null) {
  const normalized = normalizeAdminSettings(settings);
  const rows = [
    { key: "security", value: normalized.security, updated_by: updatedBy },
    { key: "finance", value: normalized.finance, updated_by: updatedBy },
    { key: "notifications", value: normalized.notifications, updated_by: updatedBy },
  ];

  const { error } = await supabase
    .from("admin_settings")
    .upsert(rows, { onConflict: "key" });

  if (error) throw error;
  return normalized;
}
