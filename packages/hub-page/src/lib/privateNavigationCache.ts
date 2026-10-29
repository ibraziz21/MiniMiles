/** Shared caches hold public assets only. Purge every historical Akiba cache. */
export async function clearPrivateNavigationCaches(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const keys = await window.caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("akiba-") && key !== "akiba-public-assets-v2")
      .map((key) => window.caches.delete(key)));
  } catch {
    // Logout must still discard the session and the in-memory router. The
    // production worker independently purges on activation and navigation.
  }
}
