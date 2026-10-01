type CompatibleCrypto = Partial<Pick<Crypto, "randomUUID" | "getRandomValues">>;

/**
 * Creates a UUID-shaped client identifier without assuming
 * `crypto.randomUUID()` exists. Some older iOS/WebView browsers expose Web
 * Crypto and `getRandomValues()` but not the newer randomUUID convenience
 * method.
 *
 * These identifiers are for idempotency and local list identity, not as
 * authentication secrets. The final fallback keeps the flow usable in very
 * old browsers where Web Crypto itself is unavailable.
 */
export function createBrowserId(
  provider: CompatibleCrypto | null | undefined = globalThis.crypto,
): string {
  if (typeof provider?.randomUUID === "function") {
    return provider.randomUUID();
  }

  if (typeof provider?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    provider.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `legacy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
