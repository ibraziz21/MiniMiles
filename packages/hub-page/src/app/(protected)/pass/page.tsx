import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { AkibaPassCard } from "../me/AkibaPassCard";

// Full-screen Pass — home-redesign-spec.md §4. The product's core gesture,
// one tap away from anywhere via the nav's Pass slot. Till moments don't
// start from home.
export const metadata = { title: "Akiba Pass" };

export default async function PassPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/pass");

  const { walletAddress, displayName } = await resolveHubProfile({
    userId: user.id,
    email: user.email ?? null,
  });
  const { publicPassId } = await getOrCreatePass({
    userId: user.id,
    email: user.email ?? null,
    walletAddress,
  });

  // Pass requires an email identity (same requirement as /me's card) — if
  // somehow absent, there's nothing to show here.
  if (!publicPassId || !user.email) redirect("/me");

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col justify-center px-4 py-8">
      <p className="mb-4 text-center text-xs font-medium text-akiba-muted">
        Turn up your screen brightness — this is what the cashier scans.
      </p>
      <AkibaPassCard
        initialPassId={publicPassId}
        email={user.email}
        displayLabel={displayName}
      />
    </main>
  );
}
