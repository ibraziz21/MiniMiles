export function merchantReturnPath(value?: string): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/merchants";
  try {
    const url = new URL(value, "https://admin.local");
    return url.origin === "https://admin.local" && url.pathname === "/merchants"
      ? url.pathname + url.search
      : "/merchants";
  } catch {
    return "/merchants";
  }
}
