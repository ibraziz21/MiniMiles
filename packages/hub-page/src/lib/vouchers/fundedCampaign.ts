// The fund is the grouping and budget boundary. Expose only the explicitly
// customer-facing title; never publish its internal name or other metadata.
export type FundedCampaignProgram = {
  id: string;
  state: string;
  metadata: { public_campaign_title?: unknown } | null;
};

export function fundedCampaignTitle(program: FundedCampaignProgram | null): string | null {
  const title = program?.metadata?.public_campaign_title;
  return typeof title === "string" ? title.trim().slice(0, 120) || null : null;
}

export function publicFundedCampaign(program: FundedCampaignProgram | null) {
  const title = fundedCampaignTitle(program);
  return program && title && (program.state === "active" || program.state === "scheduled")
    ? { id: program.id, title }
    : undefined;
}
