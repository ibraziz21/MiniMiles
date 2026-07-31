import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAllRateLimits } from "@/lib/rateLimit";
import { walletLinkingFlag } from "@/lib/featureFlags.server";
import {
  CHALLENGE_TTL_SECONDS,
  buildChallengeMessage,
  expectedDomain,
  generateNonce,
  hashChallengeSecret,
  isValidAddress,
  isValidChainIdForEcosystem,
  isValidEcosystem,
  normalizeAddress,
} from "@/lib/wallet-link";

export async function POST(request: Request) {
  if (!walletLinkingFlag().enabled) {
    return NextResponse.json({ error: "Wallet linking is not available" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const withinLimits = await checkAllRateLimits([
    { scope: `wallet_challenge:user:${user.id}`, limit: 5, windowSeconds: 600 },
  ]);
  if (!withinLimits) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const { ecosystem, address, chainId } = body ?? {};

  if (!isValidEcosystem(ecosystem)) {
    return NextResponse.json({ error: "Invalid ecosystem" }, { status: 400 });
  }
  if (typeof address !== "string" || !isValidAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  const numericChainId = Number(chainId);
  if (!Number.isInteger(numericChainId) || !isValidChainIdForEcosystem(ecosystem, numericChainId)) {
    return NextResponse.json({ error: "Invalid or unsupported chain ID" }, { status: 400 });
  }

  const normalized = normalizeAddress(address);
  const admin = createAdminClient();

  // Invalidate any existing live challenge for this (user, ecosystem, address)
  // so only one is ever outstanding — matches the partial unique index.
  await admin
    .from("wallet_link_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("hub_user_id", user.id)
    .eq("ecosystem", ecosystem)
    .eq("address", normalized)
    .is("consumed_at", null);

  const nonce = generateNonce();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);
  const domain = expectedDomain();

  const message = buildChallengeMessage({
    domain,
    hubUserId: user.id,
    address: normalized,
    ecosystem,
    chainId: numericChainId,
    nonce,
    issuedAt,
    expiresAt,
  });

  const { data: inserted, error } = await admin
    .from("wallet_link_challenges")
    .insert({
      hub_user_id: user.id,
      ecosystem,
      address: normalized,
      nonce,
      nonce_hash: hashChallengeSecret(nonce),
      statement_hash: hashChallengeSecret(message),
      chain_id: numericChainId,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (error || !inserted) {
    console.error("[wallets/challenge] insert failed:", error?.message);
    return NextResponse.json({ error: "Failed to create challenge" }, { status: 500 });
  }

  return NextResponse.json({ challengeId: inserted.id, message });
}
