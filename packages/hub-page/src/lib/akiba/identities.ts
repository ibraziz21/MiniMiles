// Builds the `identities: [{type,value}]` array the Platform's
// /api/v1/events/track contract expects (discovery-quests-spec.md §2). Every
// hub-emitted event should carry every identity known at emission time so
// Platform can match against an email-first or wallet-first quest
// participant — see getLinkedWalletAddresses for the wallet-link resolution
// this reuses.
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";

export type Identity = { type: "email" | "wallet" | "phone"; value: string };

export async function buildIdentities(opts: {
  userId: string;
  email: string | null;
}): Promise<Identity[]> {
  const identities: Identity[] = [];
  if (opts.email) identities.push({ type: "email", value: opts.email });

  const wallets = await getLinkedWalletAddresses(opts.userId);
  for (const address of wallets) {
    identities.push({ type: "wallet", value: address });
  }

  return identities;
}
