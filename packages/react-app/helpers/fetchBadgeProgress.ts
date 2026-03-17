// src/helpers/fetchBadgeProgress.ts
import {
    EMPTY_BADGE_PROGRESS,
    type BadgeProgress,
  } from "@/lib/prosperityBadges";
  
  export async function fetchBadgeProgress(owner: `0x${string}`): Promise<BadgeProgress> {
    try {
      const res = await fetch(`/api/badges/progress/${owner}`, {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
      });
  
      if (!res.ok) return { ...EMPTY_BADGE_PROGRESS };
  
      const data = await res.json();
      const values = data?.values;
  
      if (!values || typeof values !== "object") return { ...EMPTY_BADGE_PROGRESS };
  
      return {
        ...EMPTY_BADGE_PROGRESS,
        ...values,
      };
    } catch {
      return { ...EMPTY_BADGE_PROGRESS };
    }
  }
  