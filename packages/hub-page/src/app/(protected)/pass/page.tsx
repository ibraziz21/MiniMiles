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

  // Pass requires an email identity (same requirement as /me's card).
  if (!user.email) redirect("/me");

  // An infrastructure failure must not masquerade as navigation to Profile.
  // Keep the member on the Pass route with a retryable state so the core
  // action remains understandable while operators fix the backing RPC.
  if (!publicPassId) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col items-center justify-center px-6 py-8 text-center">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">
          Your Akiba Pass is temporarily unavailable
        </h1>
        <p className="mt-2 text-sm text-akiba-muted">
          We couldn&apos;t load your QR code. Your account is safe—please try again.
        </p>
        <form action="/pass" method="get" className="mt-5">
          <button
            type="submit"
            className="rounded-full bg-akiba-teal px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </form>
      </main>
    );
  }

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
