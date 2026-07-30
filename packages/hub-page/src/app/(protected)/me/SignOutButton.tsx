"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cleanupPushBeforeLogout } from "@/lib/push/browser";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    // Must run while the old session is still authenticated -- otherwise the
    // DELETE call 401s and the subscription lingers, leaking push to the
    // next signed-in user on a shared device.
    await cleanupPushBeforeLogout();

    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      className="flex items-center gap-1.5 rounded-lg border border-akiba-line px-3 py-1.5 text-xs font-medium text-akiba-muted transition hover:border-akiba-ink/20 hover:text-akiba-ink"
    >
      <LogOut className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}
