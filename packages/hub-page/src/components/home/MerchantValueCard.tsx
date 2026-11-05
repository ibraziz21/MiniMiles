import { MerchantDirectoryCard } from "@/components/merchants/MerchantDirectoryCard";
import type { MerchantValueSummary } from "@/lib/home/types";

export function MerchantValueCard({
  merchant,
  sectionId,
  position,
  event = "home_merchant_tap",
  eventProps,
}: {
  merchant: MerchantValueSummary;
  sectionId: string;
  position: number;
  event?: string;
  eventProps?: Record<string, unknown>;
}) {
  return (
    <MerchantDirectoryCard
      merchant={merchant}
      position={position}
      event={event}
      eventProps={eventProps ?? {
        merchant_id: merchant.id,
        section_id: sectionId,
        position,
        reason_kinds: merchant.reasons.map((reason) => reason.kind),
      }}
    />
  );
}
