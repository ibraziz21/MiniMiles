// Pure, unit-tested logic for the "delta nudge" line shown under a user's
// pinned weekly rank — on the challenge page and in the post-game result
// sheet. See docs/weekly-challenge-page-spec.md §4.

export type DeltaNudgeSituation =
  | "leading"
  | "prize_zone"
  | "climbing"
  | "wide_open"
  | "not_played";

export type DeltaNudgeResult = {
  situation: DeltaNudgeSituation;
  copy: string;
};

export type StandingEntry = { rank: number; score: number };

export function computeDeltaNudge(params: {
  /** null when the player has no accepted session this week. */
  myRank: number | null;
  myScore: number | null;
  /** This week's board for the game, any length. */
  entries: StandingEntry[];
  /** Prize label for rank 3, e.g. "10% off" — used in the rank 4+ copy. */
  rank3Label: string | null;
  gameName: string;
}): DeltaNudgeResult {
  const { myRank, myScore, entries, rank3Label, gameName } = params;

  if (myRank == null || myScore == null) {
    return { situation: "not_played", copy: `Play ${gameName} to get on the board` };
  }

  // Fewer than 3 distinct players ever competed for the prize zone this week
  // — whatever rank you hold, there's no real competition to describe.
  if (entries.length < 3) {
    return { situation: "wide_open", copy: "Prize zone is wide open" };
  }

  if (myRank === 1) {
    return { situation: "leading", copy: "You're in the lead — defend it 🏆" };
  }

  if (myRank <= 3) {
    const above = entries.find((e) => e.rank === myRank - 1);
    const pts = above ? Math.max(1, above.score - myScore + 1) : 1;
    return {
      situation: "prize_zone",
      copy: `You're in the prize zone — ${pts} pt${pts === 1 ? "" : "s"} to climb`,
    };
  }

  const third = entries.find((e) => e.rank === 3);
  const pts = third ? Math.max(1, third.score - myScore + 1) : 0;
  const label = rank3Label ?? "a";
  return {
    situation: "climbing",
    copy: `${pts} pt${pts === 1 ? "" : "s"} from 3rd place — a ${label} voucher`,
  };
}
