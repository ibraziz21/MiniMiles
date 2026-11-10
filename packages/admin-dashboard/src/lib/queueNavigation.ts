/** Only local review lists or merchant details can receive review navigation. */
export function queueReturnPath(value?: string | string[]): string {
  if (typeof value !== "string") return "/ops-queue";
  try {
    const url = new URL(value, "https://admin.invalid");
    return url.origin === "https://admin.invalid" &&
      (["/ops-queue", "/directory-reviews"].includes(url.pathname) ||
        /^\/merchants\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          url.pathname
        ))
      ? `${url.pathname}${url.search}`
      : "/ops-queue";
  } catch {
    return "/ops-queue";
  }
}

export function reviewHref(id: string, returnTo: string) {
  return `/directory-reviews/${encodeURIComponent(
    id
  )}?returnTo=${encodeURIComponent(queueReturnPath(returnTo))}`;
}
