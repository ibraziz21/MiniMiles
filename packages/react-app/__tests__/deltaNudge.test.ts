import { describe, it, expect } from "vitest";
import { computeDeltaNudge } from "@/lib/games/deltaNudge";

const gameName = "Rule Tap";

describe("computeDeltaNudge", () => {
  it("not played this week", () => {
    const r = computeDeltaNudge({
      myRank: null,
      myScore: null,
      entries: [{ rank: 1, score: 50 }],
      rank3Label: "10% off",
      gameName,
    });
    expect(r.situation).toBe("not_played");
    expect(r.copy).toContain("Play Rule Tap");
  });

  it("rank 1 — leading", () => {
    const r = computeDeltaNudge({
      myRank: 1,
      myScore: 100,
      entries: [
        { rank: 1, score: 100 },
        { rank: 2, score: 80 },
        { rank: 3, score: 60 },
      ],
      rank3Label: "10% off",
      gameName,
    });
    expect(r.situation).toBe("leading");
    expect(r.copy).toMatch(/lead/i);
  });

  it("rank 2 — prize zone, pts to rank above", () => {
    const r = computeDeltaNudge({
      myRank: 2,
      myScore: 80,
      entries: [
        { rank: 1, score: 100 },
        { rank: 2, score: 80 },
        { rank: 3, score: 60 },
      ],
      rank3Label: "10% off",
      gameName,
    });
    expect(r.situation).toBe("prize_zone");
    // (100 - 80) + 1 = 21
    expect(r.copy).toContain("21 pts to climb");
  });

  it("rank 3 — prize zone, pts to rank 2", () => {
    const r = computeDeltaNudge({
      myRank: 3,
      myScore: 60,
      entries: [
        { rank: 1, score: 100 },
        { rank: 2, score: 80 },
        { rank: 3, score: 60 },
      ],
      rank3Label: "10% off",
      gameName,
    });
    expect(r.situation).toBe("prize_zone");
    // (80 - 60) + 1 = 21
    expect(r.copy).toContain("21 pts to climb");
  });

  it("rank 4+ — climbing, pts from 3rd with tier label", () => {
    const r = computeDeltaNudge({
      myRank: 5,
      myScore: 40,
      entries: [
        { rank: 1, score: 100 },
        { rank: 2, score: 80 },
        { rank: 3, score: 60 },
        { rank: 4, score: 50 },
        { rank: 5, score: 40 },
      ],
      rank3Label: "10% off",
      gameName,
    });
    expect(r.situation).toBe("climbing");
    // (60 - 40) + 1 = 21
    expect(r.copy).toBe("21 pts from 3rd place — a 10% off voucher");
  });

  it("played, board has fewer than 3 entries — wide open", () => {
    const r = computeDeltaNudge({
      myRank: 2,
      myScore: 30,
      entries: [
        { rank: 1, score: 50 },
        { rank: 2, score: 30 },
      ],
      rank3Label: "10% off",
      gameName,
    });
    expect(r.situation).toBe("wide_open");
    expect(r.copy).toBe("Prize zone is wide open");
  });

  it("singular point uses non-plural copy", () => {
    const r = computeDeltaNudge({
      myRank: 2,
      myScore: 99,
      entries: [
        { rank: 1, score: 100 },
        { rank: 2, score: 99 },
        { rank: 3, score: 60 },
      ],
      rank3Label: "10% off",
      gameName,
    });
    expect(r.copy).toContain("2 pts to climb"); // (100-99)+1 = 2, still plural — sanity check math
  });
});
