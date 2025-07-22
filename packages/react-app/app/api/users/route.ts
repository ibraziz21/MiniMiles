// app/api/users/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import MiniPointsAbi from "@/contexts/minimiles.json";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const walletClient = createWalletClient({ account, chain: celo, transport: http() });

/* ── reward config (fallbacks if env missing) ─────────────────────────── */
const BASE_REWARD = process.env.REF_BASE_REWARD ?? "100"; // new user default
const NEW_USER_BONUS = process.env.REF_NEW_BONUS ?? "50";  // extra if used a code
const REFERRER_BONUS = process.env.REF_REFERRER_BONUS ?? "50";  // reward to inviter

/* helper: single mint */
async function mint(to: string, amountStr: string) {
  const { request } = await publicClient.simulateContract({
    address: process.env.MINIPOINTS_ADDRESS as `0x${string}`,
    abi: MiniPointsAbi.abi as Abi,
    functionName: "mint",
    args: [to, parseUnits(amountStr, 18)],
    account,
  });
  const hash =await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function POST(req: Request) {
  const { userAddress } = await req.json().catch(() => ({}));
  const address = (userAddress as string | undefined)?.toLowerCase();

  if (!address) {
    return NextResponse.json({ error: "userAddress is required" }, { status: 400 });
  }

  /* 1) check membership */
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", address)
    .single();

  if (userErr) {
    console.error(userErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (userRow?.is_member) {
    return NextResponse.json({ success: true, already: true });
  }

  /* 2) check if this wallet redeemed a referral code */
  const { data: refRow, error: refErr } = await supabase
    .from("referrals")
    .select("referrer_address")
    .eq("referred_address", address)
    .maybeSingle();

  if (refErr) {
    console.error(refErr);
    // still proceed without bonus
  }

  /* determine amounts */
  const newUserAmount = refRow
    ? (Number(BASE_REWARD) + Number(NEW_USER_BONUS)).toString()
    : BASE_REWARD;

  try {
    /* 3) mint to new user */
    await mint(address, newUserAmount);

    /* 4) mint to referrer if applicable */
    if (refRow?.referrer_address) {
      try {
        await mint(refRow.referrer_address.toLowerCase(), REFERRER_BONUS);
      } catch (e) {
        console.error("referrer mint failed:", e);
        // do not fail the whole request; just log
      }
    }
  } catch (e) {
    console.error("mint failed:", e);
    return NextResponse.json({ error: "Mint failed" }, { status: 500 });
  }

  /* 5) mark as member */
  const { error: upErr } = await supabase
    .from("users")
    .upsert({ user_address: address, is_member: true }, { onConflict: "user_address" });

  if (upErr) {
    console.error(upErr);
    // token mint is irreversible; still return success
  }

  return NextResponse.json({
    success: true,
    already: false,
    awarded: newUserAmount,
    referrerRewarded: !!refRow?.referrer_address,
  });
}
