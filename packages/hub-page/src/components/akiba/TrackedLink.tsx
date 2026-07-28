"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/lib/analytics/track";

type Props = ComponentProps<typeof Link> & {
  event: string;
  eventProps?: Record<string, unknown>;
};

/** next/link that fires an analytics event on click — lets server components
 *  render tappable rows without becoming client components themselves. */
export function TrackedLink({ event, eventProps, onClick, ...props }: Props) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        track(event, eventProps);
        onClick?.(e);
      }}
    />
  );
}
