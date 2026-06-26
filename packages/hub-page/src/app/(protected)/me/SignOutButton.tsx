"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
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
      Sign out
    </button>
  );
}
