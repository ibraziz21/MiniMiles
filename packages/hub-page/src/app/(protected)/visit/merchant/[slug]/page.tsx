import Link from "next/link";
import { ArrowLeft, BadgeCheck, ReceiptText } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { resolveMerchantContributionFromMilesIssuance } from "@/lib/akiba/discoveryContributions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add your visit — Akiba" };

export default async function MerchantVisitEntryPage({ params }: { params: { slug: string } }) {
  const returnPath = `/visit/merchant/${params.slug}`;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect(`/login?next=${encodeURIComponent(returnPath)}`);
  }

  const admin = createAdminClient();
  const { data: merchant, error: merchantError } = await admin
    .from("partners")
    .select("id, name, slug")
    .eq("slug", params.slug)
    .eq("type", "merchant")
    .eq("status", "active")
    .maybeSingle();

  if (merchantError) {
    console.error("[merchant-visit-entry] merchant lookup failed:", merchantError.message);
  }
  if (!merchant) notFound();

  const resolution = await resolveMerchantContributionFromMilesIssuance({
    hubUserId: user.id,
    email: user.email ?? null,
    merchantId: merchant.id,
  });
  if (resolution.requestId) redirect(`/visit/${resolution.requestId}`);

  const lookupFailed = resolution.status === "lookup_failed";
  const issuanceFound = resolution.issuanceFound;
  const heading = lookupFailed
    ? "We couldn’t check your visit"
    : issuanceFound
      ? "Your Miles are verified"
      : "No recent Miles earned here";
  const explanation = lookupFailed
    ? "Akiba couldn’t check your Miles activity right now. Try again in a moment."
    : issuanceFound
      ? `We found Miles earned at ${merchant.name}, but a new visit report is not available right now.`
      : `After you earn Miles from an eligible in-store purchase at ${merchant.name}, you can add what you tried, recommend items and optionally share photos here.`;

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-3xl border border-akiba-line bg-white p-5 shadow-soft sm:p-8">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-akiba-tint text-akiba-teal">
          <BadgeCheck className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-sterling text-2xl font-semibold text-akiba-ink">
          {heading}
        </h1>
        <p className="mt-2 text-sm leading-6 text-akiba-muted">
          {explanation}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {lookupFailed && (
            <Link
              href={returnPath}
              className="flex min-h-11 touch-manipulation items-center justify-center rounded-full bg-akiba-teal px-5 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2"
            >
              Try again
            </Link>
          )}
          <Link
            href={`/merchants/${merchant.slug}#photos`}
            className={`flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 ${
              lookupFailed
                ? "border border-akiba-line text-akiba-ink"
                : "bg-akiba-ink text-white"
            }`}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {merchant.name}
          </Link>
          <Link
            href="/earn"
            className="flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-full border border-akiba-line px-5 py-2 text-sm font-semibold text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <ReceiptText className="h-4 w-4" aria-hidden="true" />
            How earning works
          </Link>
        </div>

        <p className="mt-5 text-xs leading-5 text-akiba-muted">
          Adding a visit is optional and never changes the Miles you earned.
        </p>
      </section>
    </main>
  );
}
