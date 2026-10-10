import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  const result = manifest();

  it("uses the approved brand name for both name and short_name", () => {
    expect(result.name).toBe("AkibaMiles Admin");
    expect(result.short_name).toBe("AkibaMiles Admin");
  });

  it("is standalone display mode", () => {
    expect(result.display).toBe("standalone");
  });

  it("includes required 192 and 512 icons plus a maskable 512 icon", () => {
    const icons = result.icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192" && i.purpose !== "maskable")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose !== "maskable")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  });
});
