import { redirect } from "next/navigation";

// Preserved as a deep-link/compatibility redirect — standings now live in
// the Leaderboards section on /games itself rather than a dedicated page.
export default async function LeaderboardRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ gameType?: string }>;
}) {
  const { gameType } = await searchParams;
  const query = gameType ? `&gameType=${encodeURIComponent(gameType)}` : "";
  redirect(`/games?section=leaderboard${query}`);
}
