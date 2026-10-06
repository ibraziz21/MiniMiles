import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listSavedMerchants } from "@/lib/merchants/savedMerchants";
import { SavedMerchantsSection } from "../SavedMerchantsSection";

export const metadata = { title: "Saved Places — Akiba Pass" };

export default async function SavedPlacesPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/me/saved");

  const merchants = await listSavedMerchants(user.id);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-8">
      <Link
        href="/me"
        className="mb-5 inline-flex min-h-11 items-center gap-1.5 rounded-lg pr-3 text-sm font-medium text-akiba-muted transition hover:text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to profile
      </Link>
      <SavedMerchantsSection merchants={merchants} showEmpty expanded />
    </main>
  );
}
