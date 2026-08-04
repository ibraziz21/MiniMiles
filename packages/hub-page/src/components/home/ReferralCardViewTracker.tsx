"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/** Fires referral_card_view once on mount (referral-system-spec.md §13.1) —
 *  the card itself is a server component and can't call track() directly. */
export function ReferralCardViewTracker({ hasActivity }: { hasActivity: boolean }) {
  useEffect(() => {
    track("referral_card_view", { has_activity: hasActivity });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
