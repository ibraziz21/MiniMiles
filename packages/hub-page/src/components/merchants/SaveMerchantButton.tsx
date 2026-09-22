"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, Loader2 } from "lucide-react";
import clsx from "clsx";

/**
 * Save/follow a merchant (discovery-blueprint.md §6/§8) — backed by
 * POST|DELETE /api/merchants/[slug]/save. Optimistic toggle with rollback
 * on failure, matching the icon-button style already used for the
 * Instagram/Facebook/Email links on this page.
 */
export function SaveMerchantButton({
  slug,
  isSignedIn,
  initialSaved,
}: {
  slug: string;
  isSignedIn: boolean;
  initialSaved: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (!isSignedIn) {
      router.push("/login");
      return;
    }
    if (pending) return;

    const next = !saved;
    setSaved(next);
    setPending(true);
    try {
      const res = await fetch(`/api/merchants/${slug}/save`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) throw new Error("save_failed");
      const data = (await res.json()) as { saved: boolean };
      setSaved(data.saved);
    } catch {
      setSaved(!next); // roll back the optimistic update
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved merchants" : "Save this merchant"}
      title={saved ? "Saved" : "Save"}
      className={clsx(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal",
        saved
          ? "border-akiba-teal bg-akiba-tint text-akiba-teal"
          : "border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40 hover:text-akiba-teal"
      )}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : saved ? (
        <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Bookmark className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
