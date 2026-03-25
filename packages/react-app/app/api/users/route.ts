// app/api/users/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
import { isBlacklisted } from "@/lib/blacklist";

/* ── setup ───────────────────────────────────────────────────────── */
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const walletClient = createWalletClient({ account, chain: celo, transport: http() });

const TOKEN = process.env.MINIPOINTS_ADDRESS as `0x${string}`;

/* rewards (strings -> numbers) */
const BASE_REWARD = Number(process.env.REF_BASE_REWARD ?? "100");
const NEW_USER_BONUS = Number(process.env.REF_NEW_BONUS ?? "100");
const REFERRER_BONUS = Number(process.env.REF_REFERRER_BONUS ?? "100");

/* ── helpers ─────────────────────────────────────────────────────── */
type MintTarget = { to: `0x${string}`; amount: bigint };

async function simulateAll(mints: MintTarget[]) {
  return Promise.all(
    mints.map(({ to, amount }) =>
      publicClient.simulateContract({
        address: TOKEN,
        abi: MiniPointsAbi.abi as Abi,
        functionName: "mint",
        args: [to, amount],
        account,
      })
    )
  );
}

async function executeAll(simResults: Awaited<ReturnType<typeof simulateAll>>) {
  const hashes: string[] = [];
  for (const { request } of simResults) {
    const hash = await walletClient.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    hashes.push(hash);
  }
  return hashes;
}

/* ── route ───────────────────────────────────────────────────────── */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body?.userAddress;
  if (!raw) return NextResponse.json({ error: "userAddress is required" }, { status: 400 });

  let userAddr: `0x${string}`;
  try {
    userAddr = getAddress(raw) as `0x${string}`;
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  if (await isBlacklisted(userAddr)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  /* 1) claim registration slot atomically — prevents race-condition double-mints.
     INSERT fails with 23505 if the address already exists, so only one concurrent
     request can ever proceed to mint. */
  const { error: insertErr } = await supabase
    .from("users")
    .insert({ user_address: userAddr.toLowerCase(), is_member: false });

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json({ success: true, already: true });
    }
    console.error("insert users err:", insertErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  /* 2) referral check */
  const { data: refRow, error: refErr } = await supabase
    .from("referrals")
    .select("referrer_address, referrer_rewarded")
    .eq("referred_address", userAddr.toLowerCase())
    .maybeSingle();

  if (refErr) console.error(refErr);

  let refAddr: `0x${string}` | null = null;
  if (refRow?.referrer_address) {
    try {
      const candidate = getAddress(refRow.referrer_address) as `0x${string}`;
      if (candidate !== userAddr) refAddr = candidate;
    } catch {
      /* ignore bad stored address */
    }
  }

  /* 3) determine amounts
     New user gets their bonus immediately.
     Referrer bonus is intentionally withheld here — it is paid later via
     /api/referral/claim-referrer-bonus once the referred user has 3+ days of activity.
  */
  const newUserAmountNum = refAddr
    ? BASE_REWARD + NEW_USER_BONUS
    : BASE_REWARD;

  const mints: MintTarget[] = [
    { to: userAddr, amount: parseUnits(newUserAmountNum.toString(), 18) },
    // Note: referrer bonus is NOT minted here. See /api/referral/claim-referrer-bonus.
  ];

  /* 4) pre-flight simulate BOTH */
  let sims;
  try {
    sims = await simulateAll(mints);
  } catch (e) {
    console.error("simulate failed:", e);
    return NextResponse.json({ error: "Simulation failed" }, { status: 500 });
  }

  /* 5) execute */
  let txHashes: string[] = [];
  try {
    txHashes = await executeAll(sims);
  } catch (e) {
    console.error("mint failed:", e);
    return NextResponse.json({ error: "Mint failed" }, { status: 500 });
  }

  /* 6) mark as member (row was inserted in step 1, just flip the flag) */
  const { error: upErr } = await supabase
    .from("users")
    .update({ is_member: true })
    .eq("user_address", userAddr.toLowerCase());
  if (upErr) console.error("update is_member err:", upErr);

  return NextResponse.json({
    success: true,
    already: false,
    awarded: newUserAmountNum.toString(),
    referrerRewardPending: Boolean(refAddr),
    txHashes,
  });
}
