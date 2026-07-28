// Single source of truth for voucher distribution channels — merchant-ux-spec.md
// §3 ("Do not display 'template' or 'program'...") and §5 Step 4. Replaces the
// three previously-duplicated CHANNEL_LABELS maps (NewProgramForm, programs/page,
// programs/[id]/page) and the app-level valid-channel Set in api/programs/route.ts
// (that Set still exists for request validation — keep both in sync if this list
// changes).
//
// weekly_leaderboard_challenge became selectable once migration
// 045_weekly_leaderboard_channel.sql added it to the DB-side channel enum — that
// migration is the "runtime-backed channel identifier" merchant-ux-spec.md §14
// required before this channel could stop being "Coming soon".

export const HUB_CHANNEL = "miles_purchase" as const;

export type AdditionalChannel =
  | "weekly_leaderboard_challenge"
  | "claw"
  | "raffle"
  | "giveaway"
  | "merchant_grant";

export const ADDITIONAL_CHANNELS: ReadonlyArray<{
  value: AdditionalChannel;
  label: string;
  description: string;
}> = [
  {
    value: "weekly_leaderboard_challenge",
    label: "Weekly Leaderboard Challenge",
    description: "Award vouchers to qualifying weekly leaderboard participants.",
  },
  {
    value: "claw",
    label: "Claw Game",
    description: "Make vouchers available as prizes in the Akiba Claw Game.",
  },
  {
    value: "raffle",
    label: "Raffle",
    description: "Allocate vouchers to an Akiba raffle campaign.",
  },
  {
    value: "giveaway",
    label: "Giveaway",
    description: "Distribute vouchers through a platform-managed giveaway.",
  },
  {
    value: "merchant_grant",
    label: "Merchant Grant",
    description: "Let authorized staff issue vouchers directly to customers.",
  },
];

// Includes akiba_grant (Akiba-authored programs, not merchant-selectable in the
// wizard) so list/detail pages can still label pre-existing rows.
export const CHANNEL_LABELS: Record<string, string> = {
  [HUB_CHANNEL]: "Hub Miles Purchase",
  akiba_grant: "Akiba Grant",
  ...Object.fromEntries(ADDITIONAL_CHANNELS.map((c) => [c.value, c.label])),
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}
