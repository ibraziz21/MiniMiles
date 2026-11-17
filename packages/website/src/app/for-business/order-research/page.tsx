import type { Metadata } from "next";
import { merchantInviteId, surveyCohorts } from "@/lib/merchant-order-research";
import { ResearchForm } from "./research-form";

export const metadata: Metadata = {
  title: "Merchant research | Online orders",
  description: "Tell Akiba how your business takes orders from customers today.",
  robots: { index: false, follow: false },
};

export default function OrderResearchPage({
  searchParams,
}: {
  searchParams: { merchant_id?: string | string[]; cohort?: string | string[] };
}) {
  const cohort = searchParams.cohort;
  return <ResearchForm
    merchantId={merchantInviteId(searchParams.merchant_id)}
    cohort={typeof cohort === "string" && surveyCohorts.includes(cohort) ? cohort : undefined}
  />;
}
