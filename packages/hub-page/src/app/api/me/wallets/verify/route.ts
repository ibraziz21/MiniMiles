import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAllRateLimits } from "@/lib/rateLimit";
import { walletLinkingFlag } from "@/lib/featureFlags.server";
import { reemitPassActivated } from "@/lib/akiba/internal-events";
import { bridgeLegacyUsersRow } from "@/lib/akiba/legacyUsersBridge";
import {
  buildChallengeMessage,
  expectedDomain,
  hashChallengeSecret,
  verifySignedMessage,
} from "@/lib/wallet-link";

export async function POST(request: Request) {
  if (!walletLinkingFlag().enabled) {
    return NextResponse.json({ error: "Wallet linking is not available" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const withinLimits = await checkAllRateLimits([
    { scope: `wallet_verify:user:${user.id}`, limit: 10, windowSeconds: 600 },
  ]);
  if (!withinLimits) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const { challengeId, signature } = body ?? {};

  if (typeof challengeId !== "string" || typeof signature !== "string" || !signature.startsWith("0x")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: challenge, error: loadError } = await admin
    .from("wallet_link_challenges")
    .select("id, hub_user_id, ecosystem, address, nonce, nonce_hash, chain_id, expires_at, consumed_at, created_at")
    .eq("id", challengeId)
    .maybeSingle();

  if (loadError) {
    console.error("[wallets/verify] load failed:", loadError.message);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
  if (!challenge || challenge.hub_user_id !== user.id) {
    return NextResponse.json({ error: "Challenge not found" }, { status: 404 });
  }
  if (challenge.consumed_at) {
    return NextResponse.json({ error: "Challenge already used" }, { status: 409 });
  }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Challenge expired" }, { status: 409 });
  }

  const message = buildChallengeMessage({
    domain: expectedDomain(),
    hubUserId: user.id,
    address: challenge.address,
    ecosystem: challenge.ecosystem,
    chainId: challenge.chain_id,
    nonce: challenge.nonce,
    issuedAt: new Date(challenge.created_at),
    expiresAt: new Date(challenge.expires_at),
  });

  // Defense in depth: confirms the row hasn't been tampered with in a way
  // that would change the message we're about to verify against.
  if (hashChallengeSecret(challenge.nonce) !== challenge.nonce_hash) {
    console.error("[wallets/verify] nonce/nonce_hash mismatch for challenge", challengeId);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  const signatureValid = await verifySignedMessage(message, signature, challenge.address);
  if (!signatureValid) {
    return NextResponse.json({ error: "Signature does not match the challenged wallet" }, { status: 400 });
  }

  const { data: linkRows, error: linkError } = await admin.rpc("link_verified_wallet", {
    p_challenge_id: challengeId,
    p_hub_user_id: user.id,
    p_method: "eip191",
  });

  const result = (linkRows as Array<{ ok: boolean; error_code: string | null; address: string | null; ecosystem: string | null }> | null)?.[0];

  if (linkError || !result) {
    console.error("[wallets/verify] link_verified_wallet failed:", linkError?.message);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  if (!result.ok) {
    const status = result.error_code === "already_consumed" || result.error_code === "expired" ? 409 : 400;
    return NextResponse.json({ error: result.error_code ?? "verification_failed" }, { status });
  }

  await bridgeLegacyUsersRow({
    walletAddress: challenge.address,
    hubUserId: user.id,
    hubEmail: user.email ?? null,
  });

  await reemitPassActivated({ userId: user.id, email: user.email ?? null });

  return NextResponse.json({ ok: true, ecosystem: result.ecosystem, address: result.address });
}
