import { it, expect } from "vitest";
import { readAllRows } from "@/lib/readAllRows";
it("reads past the API page cap without dropping records", async () => {
  const rows = Array.from({ length: 1234 }, (_, id) => ({ id }));
  const calls: number[] = [];
  const result = await readAllRows(async (from, to) => {
    calls.push(from);
    return { data: rows.slice(from, to + 1), error: null };
  });
  expect(result).toEqual(rows);
  expect(calls).toEqual([0, 500, 1000]);
});
it("rejects partial totals when a later page fails", async () => {
  await expect(
    readAllRows(async (from) =>
      from === 0
        ? { data: Array(500).fill({}), error: null }
        : { data: null, error: { message: "offline" } }
    )
  ).rejects.toThrow();
});

it("chunks reference lookups below the URL and row caps", async () => {
  const { readReferenceChunks } = await import("@/lib/readAllRows");
  const ids = Array.from({ length: 603 }, (_, i) => String(i));
  const calls: number[] = [];
  const result = await readReferenceChunks(ids, async (chunk) => {
    calls.push(chunk.length);
    return { data: chunk, error: null };
  });
  expect(result).toEqual(ids);
  expect(calls).toEqual([200, 200, 200, 3]);
});
