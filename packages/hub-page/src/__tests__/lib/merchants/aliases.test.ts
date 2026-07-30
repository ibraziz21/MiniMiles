import { describe, expect, it } from "vitest";
import { expandQueryAlias } from "@/lib/merchants/aliases";

describe("expandQueryAlias", () => {
  it("expands a known alias to its canonical term", () => {
    expect(expandQueryAlias("wifi")).toBe("internet");
    expect(expandQueryAlias("petrol")).toBe("fuel");
  });

  it("is case/whitespace insensitive on the match, but does not alter casing of a pass-through query", () => {
    expect(expandQueryAlias("  WiFi  ")).toBe("internet");
    expect(expandQueryAlias("Burger Palace")).toBe("Burger Palace");
  });

  it("does not rewrite a multi-word phrase that merely contains an alias token", () => {
    expect(expandQueryAlias("wifi router repair")).toBe("wifi router repair");
  });

  it("passes through an unknown query unchanged", () => {
    expect(expandQueryAlias("burger")).toBe("burger");
    expect(expandQueryAlias("")).toBe("");
  });
});
