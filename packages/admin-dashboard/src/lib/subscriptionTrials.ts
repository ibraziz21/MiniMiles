export const DEFAULT_TRIAL_DAYS = 2;
export const MAX_TRIAL_DAYS = 30;

export const SUBSCRIPTION_TRIAL_RPC = "admin_grant_partner_trial";

export function parseTrialDays(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > MAX_TRIAL_DAYS) return null;
  return value;
}

export function trialGrantErrorMessage(code: string | undefined): string {
  switch (code) {
    case "PARTNER_NOT_FOUND":
      return "Merchant not found.";
    case "PAID_SUBSCRIPTION_EXISTS":
      return "This merchant already has a paid subscription.";
    case "SUBSCRIPTION_NOT_ELIGIBLE":
      return "This subscription is not eligible for an onboarding trial.";
    case "PLAN_DEFAULTS_NOT_FOUND":
      return "Basic plan defaults are not configured.";
    default:
      return code ?? "Could not grant the trial.";
  }
}
