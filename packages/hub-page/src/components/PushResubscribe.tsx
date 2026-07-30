"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { resubscribeIfNeeded } from "@/lib/push/browser";

// Closes the account-switching gap from an interrupted logout (spec §7): if
// a local push subscription already exists, rebind it to whoever is
// currently authenticated. Never requests permission itself.
export function PushResubscribe() {
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await resubscribeIfNeeded();
    })();
  }, []);
  return null;
}
