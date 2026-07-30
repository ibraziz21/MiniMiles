"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/** Fires home_section_view once on mount — the section rail is a server
 *  component and can't call the client-only track() itself. Renders nothing. */
export function SectionViewTracker({ sectionId, personalized }: { sectionId: string; personalized: boolean }) {
  useEffect(() => {
    track("home_section_view", { section_id: sectionId, personalized });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);
  return null;
}
