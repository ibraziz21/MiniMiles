import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(__dirname, "../../../../../supabase/migrations/073_restore_marketing_push_enqueue.sql"),
  "utf8",
);

describe("marketing push enqueue repair migration", () => {
  it.each([
    ["marketing", "feature_announcement"],
    ["marketing", "merchant_announcement"],
    ["marketing", "general_announcement"],
    ["earnings", "miles_earned"],
  ])("keeps the %s/%s route eligible", (category, template) => {
    expect(migration).toContain(`p_category = '${category}'`);
    expect(migration).toContain(`'${template}'`);
  });

  it("uses the shared predicate from the enqueue trigger", () => {
    expect(migration).toContain(
      "web_push_notification_is_eligible(NEW.category, NEW.template)",
    );
  });

  it("backfills missing campaign jobs idempotently", () => {
    expect(migration).toContain("n.campaign_id IS NOT NULL");
    expect(migration).toContain("n.category = 'marketing'");
    expect(migration).toContain("ON CONFLICT (notification_id) DO NOTHING");
  });
});
