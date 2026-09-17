"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

/**
 * Fires merchant_profile_view and, when applicable, merchant_voucher_view
 * once on mount — the merchant detail page is a
 * server component and can't call the client-only track() itself. Renders
 * nothing. Only identifiers are logged, never addresses/contacts/coordinates.
 */
export function MerchantViewTracker({
  merchantId,
  hasVouchers,
}: {
  merchantId: string;
  hasVouchers: boolean;
}) {
  useEffect(() => {
    track("merchant_profile_view", { merchantId });
    if (hasVouchers) track("merchant_voucher_view", { merchantId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);
  return null;
}
