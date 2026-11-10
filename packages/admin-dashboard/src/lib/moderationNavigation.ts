export function validModerationId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
export function moderationPage(value?: string) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10000 ? page : 1;
}
export function moderationReturnPath(
  value: string | undefined,
  fallback = "/discovery-photos"
) {
  if (!value) return fallback;
  try {
    const url = new URL(value, "https://admin.invalid");
    return url.origin === "https://admin.invalid" &&
      ["/ops-queue", "/discovery-photos", "/discovery-reports"].includes(
        url.pathname
      )
      ? url.pathname + url.search
      : fallback;
  } catch {
    return fallback;
  }
}
