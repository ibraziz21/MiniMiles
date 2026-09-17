"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cleanupPushBeforeLogout } from "@/lib/push/browser";
import { LogOut } from "lucide-react";
import { SettingsRow } from "@/components/akiba/SettingsRow";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    // Must run while the old session is still authenticated -- otherwise the
    // DELETE call 401s and the subscription lingers, leaking push to the
    // next signed-in user on a shared device.
    await cleanupPushBeforeLogout();

    // Referral attribution is HttpOnly, so client JS can't clear it
    // directly — a shared-device account switch must not let a stale
    // attribution cookie from this session bind to the next signup
    // (referral-system-spec.md §8 "logout/account switch"). Best-effort:
    // sign-out must proceed even if this fails.
    await fetch("/api/auth/clear-referral-attribution", { method: "POST" }).catch(() => {});

    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <SettingsRow
      icon={<LogOut className="h-4 w-4 text-red-500" aria-hidden="true" />}
      label="Sign out"
      variant="danger"
      showChevron={false}
      onClick={signOut}
    />
  );
}
