"use client";

import type { ComponentProps } from "react";
import { track } from "@/lib/analytics/track";

type Props = ComponentProps<"a"> & {
  event: string;
  eventProps?: Record<string, unknown>;
};

/**
 * Plain `<a>` (external/tel/mailto/wa.me — not an in-app route, so
 * next/link's `TrackedLink` doesn't apply) that fires an analytics event on
 * click, letting server components render tappable rows without becoming
 * client components themselves. Never pass raw addresses/phone numbers/
 * coordinates in `eventProps` — only identifiers (e.g. merchantId).
 */
export function TrackedAnchor({ event, eventProps, onClick, ...props }: Props) {
  return (
    <a
      {...props}
      onClick={(e) => {
        track(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
