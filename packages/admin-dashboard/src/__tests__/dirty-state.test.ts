import { describe, expect, it } from "vitest";
import { isDirty, setDirty, subscribeDirty } from "@/lib/dirty-state";

describe("dirty-state", () => {
  it("tracks dirty state and notifies subscribers", () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeDirty((dirty) => seen.push(dirty));

    expect(isDirty()).toBe(false);
    setDirty(true);
    expect(isDirty()).toBe(true);
    setDirty(false);
    expect(isDirty()).toBe(false);

    expect(seen).toEqual([true, false]);
    unsubscribe();
  });
});
