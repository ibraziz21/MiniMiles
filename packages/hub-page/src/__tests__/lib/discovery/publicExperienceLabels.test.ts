import { describe, expect, it } from "vitest";
import { extractPublicExperienceLabels } from "@/lib/discovery/publicExperienceLabels";

const template = {
  experience_options: [
    { id: "friendly", publicLabel: "Friendly staff", inputLabel: "must not leak" },
    { id: "relaxed", publicLabel: "Relaxed atmosphere" },
    { id: "no-label" },
  ],
};

describe("extractPublicExperienceLabels", () => {
  it("resolves only the selected option ids to their public labels, in template order", () => {
    expect(extractPublicExperienceLabels(template, ["relaxed", "friendly"])).toEqual([
      "Friendly staff",
      "Relaxed atmosphere",
    ]);
  });

  it("never returns inputLabel or other non-public fields", () => {
    const result = extractPublicExperienceLabels(template, ["friendly"]);
    expect(JSON.stringify(result)).not.toContain("must not leak");
  });

  it("ignores an unrecognized selected id", () => {
    expect(extractPublicExperienceLabels(template, ["friendly", "does-not-exist"])).toEqual(["Friendly staff"]);
  });

  it("drops an option with no publicLabel", () => {
    expect(extractPublicExperienceLabels(template, ["no-label"])).toEqual([]);
  });

  it("returns an empty array for a missing or malformed template", () => {
    expect(extractPublicExperienceLabels(null, ["friendly"])).toEqual([]);
    expect(extractPublicExperienceLabels({}, ["friendly"])).toEqual([]);
    expect(extractPublicExperienceLabels(template, null)).toEqual([]);
  });

  it("applies a limit when given one", () => {
    expect(extractPublicExperienceLabels(template, ["friendly", "relaxed"], 1)).toEqual(["Friendly staff"]);
  });

  it("truncates an overlong label to 80 characters", () => {
    const longLabel = "x".repeat(200);
    const longTemplate = { experience_options: [{ id: "long", publicLabel: longLabel }] };
    const result = extractPublicExperienceLabels(longTemplate, ["long"]);
    expect(result[0]).toHaveLength(80);
  });
});
