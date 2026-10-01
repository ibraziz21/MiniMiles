import { describe, expect, it, vi } from "vitest";
import { createBrowserId } from "@/lib/browserId";

describe("createBrowserId", () => {
  it("uses crypto.randomUUID when the browser provides it", () => {
    const randomUUID = vi.fn(() => "native-uuid") as Crypto["randomUUID"];

    expect(createBrowserId({ randomUUID })).toBe("native-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a valid v4 UUID with getRandomValues in older browsers", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    }) as unknown as Crypto["getRandomValues"];

    const id = createBrowserId({ getRandomValues });

    expect(id).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps the UI usable when Web Crypto is completely unavailable", () => {
    expect(createBrowserId(null)).toMatch(/^legacy-[a-z0-9]+-[a-z0-9]+$/);
  });
});
