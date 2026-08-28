"use client";

import { track } from "@/lib/analytics/track";

export function MilesEarnedLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      onClick={() => track("miles_earned_notification_opened", { destination: href })}
      className="text-xs text-akiba-teal hover:underline"
    >
      View progress
    </a>
  );
}
