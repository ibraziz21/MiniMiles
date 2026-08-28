"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/**
 * Fires next_reward_view / next_reward_unavailable once on mount
 * (next-reward-progress-v1-spec.md §11) — a server component can't call the
 * client-only track() itself. Never includes balance, exact gap, country,
 * email or wallet — only the non-sensitive props the spec allows. Renders
 * nothing.
 */
export function NextRewardViewTracker(
  props:
    | { surface: "home" | "me"; state: "unavailable"; reason: string }
    | {
        surface: "home" | "me";
        state: "locked" | "affordable" | "no_eligible_reward";
        templateId?: string | null;
        merchantId?: string | null;
        recommendationLabel?: string | null;
        progressBucket?: "0_24" | "25_49" | "50_74" | "75_99" | "affordable" | null;
      }
) {
  useEffect(() => {
    if (props.state === "unavailable") {
      track("next_reward_unavailable", { surface: props.surface, reason: props.reason });
      return;
    }
    track("next_reward_view", {
      surface: props.surface,
      template_id: props.templateId ?? null,
      merchant_id: props.merchantId ?? null,
      state: props.state,
      recommendation_label: props.recommendationLabel ?? null,
      progress_bucket: props.progressBucket ?? null,
    });
    // Fire once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function progressBucket(percent: number, affordable: boolean): "0_24" | "25_49" | "50_74" | "75_99" | "affordable" {
  if (affordable) return "affordable";
  if (percent < 25) return "0_24";
  if (percent < 50) return "25_49";
  if (percent < 75) return "50_74";
  return "75_99";
}
