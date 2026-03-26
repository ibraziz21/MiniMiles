// app/api/referral/claim-referrer-bonus/route.ts
//
// Pays the referrer bonus for each of their referrals where the referred
// wallet has been active for 7+ days with 3+ daily quest claims.
//
// Call this from the referrer's profile/rewards page, or as a background job.
// POST { referrerAddress: "0x..." }

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isBlacklisted } from "@/lib/blacklist";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Abi,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import MiniPointsAbi from "@/contexts/minimiles.json";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const walletClient = createWalletClient({ account, chain: celo, transport: http() });
const TOKEN = process.env.MINIPOINTS_ADDRESS as `0x${string}`;
const REFERRER_BONUS = Number(process.env.REF_REFERRER_BONUS ?? "100");

// Referred wallet must have this many daily quest claims before referrer is paid
const MIN_ENGAGEMENT_DAYS = 3;
// Referred wallet must have been registered for this many days
const MIN_DAYS_SINCE_REFERRAL = 7;

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let referrerAddr: string;
  try {
    referrerAddr = getAddress(body?.referrerAddress).toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid referrerAddress" }, { status: 400 });
  }

  if (await isBlacklisted(referrerAddr, "referral/claim-referrer-bonus")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Find all referrals made by this address that haven't been rewarded yet
  const { data: pendingReferrals, error: refErr } = await supabase
    .from("referrals")
    .select("referred_address, redeemed_at")
    .eq("referrer_address", referrerAddr)
    .eq("referrer_rewarded", false)
    .not("redeemed_at", "is", null);

  if (refErr) {
    console.error(refErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (!pendingReferrals || pendingReferrals.length === 0) {
    return NextResponse.json({ ok: true, paid: 0, message: "No pending referral bonuses" });
  }

  const now = new Date();
  const eligible: string[] = [];

  for (const ref of pendingReferrals) {
    const redeemedAt = new Date(ref.redeemed_at);
    const daysSinceReferral = (now.getTime() - redeemedAt.getTime()) / 86400000;

    // Must be 7+ days since the referral was redeemed
    if (daysSinceReferral < MIN_DAYS_SINCE_REFERRAL) continue;

    // Must have 3+ daily quest claims
    const { count } = await supabase
      .from("daily_engagements")
      .select("*", { count: "exact", head: true })
      .eq("user_address", ref.referred_address);

    if ((count ?? 0) >= MIN_ENGAGEMENT_DAYS) {
      eligible.push(ref.referred_address);
    }
  }

  if (eligible.length === 0) {
    return NextResponse.json({
      ok: true,
      paid: 0,
      message: `${pendingReferrals.length} referral(s) pending but none meet the 7-day / ${MIN_ENGAGEMENT_DAYS}-quest activity requirement yet`,
    });
  }

  // Atomically claim the reward slots before minting — prevents double-mint on concurrent calls.
  // Only rows still false are flipped; concurrent requests get 0 rows back and mint nothing.
  const { data: claimed, error: claimErr } = await supabase
    .from("referrals")
    .update({ referrer_rewarded: true })
    .eq("referrer_address", referrerAddr)
    .eq("referrer_rewarded", false)
    .in("referred_address", eligible)
    .select("referred_address");

  if (claimErr) {
    console.error("Failed to claim referral reward slots:", claimErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const toMint = (claimed ?? []).map((r: { referred_address: string }) => r.referred_address);

  if (toMint.length === 0) {
    return NextResponse.json({ ok: true, paid: 0, message: "No pending referral bonuses" });
  }

  const amount = parseUnits(REFERRER_BONUS.toString(), 18);
  const referrerChecksummed = getAddress(referrerAddr) as `0x${string}`;

  const txHashes: string[] = [];
  const rewarded: string[] = [];

  for (const referredAddr of toMint) {
    try {
      const { request } = await publicClient.simulateContract({
        address: TOKEN,
        abi: MiniPointsAbi.abi as Abi,
        functionName: "mint",
        args: [referrerChecksummed, amount],
        account,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      txHashes.push(hash);
      rewarded.push(referredAddr);
    } catch (e) {
      console.error(`[claim-referrer-bonus] mint failed for referral ${referredAddr}:`, e);
      // Roll back the flag for this referral so it can be retried
      await supabase
        .from("referrals")
        .update({ referrer_rewarded: false })
        .eq("referrer_address", referrerAddr)
        .eq("referred_address", referredAddr);
    }
  }

  return NextResponse.json({
    ok: true,
    paid: rewarded.length,
    skipped: toMint.length - rewarded.length,
    totalBonus: rewarded.length * REFERRER_BONUS,
    txHashes,
  });
}
