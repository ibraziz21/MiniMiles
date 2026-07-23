"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/** Fires home_view{variant} once on mount — a server component (MemberHome/
 *  VisitorLanding) can't call the client-only track() itself. Renders nothing. */
export function HomeViewTracker({ variant }: { variant: "member" | "visitor" }) {
  useEffect(() => {
    track("home_view", { variant });
  }, [variant]);
  return null;
}
