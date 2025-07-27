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

/* ── setup ───────────────────────────────────────────────────────── */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY!}`);
const publicClient = createPublicClient({ chain: celo, transport: http() });
const walletClient = createWalletClient({ account, chain: celo, transport: http() });

const TOKEN = process.env.MINIPOINTS_ADDRESS as `0x${string}`;

/* rewards (strings -> numbers) */
const BASE_REWARD = Number(process.env.REF_BASE_REWARD ?? "100");
const NEW_USER_BONUS = Number(process.env.REF_NEW_BONUS ?? "50");
const REFERRER_BONUS = Number(process.env.REF_REFERRER_BONUS ?? "50");

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
    userAddr = getAddress(raw);
  } catch {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  /* 1) membership check */
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("is_member")
    .eq("user_address", userAddr.toLowerCase())
    .single();

  if (userErr && userErr.code !== "PGRST116") {
    console.error(userErr);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
  if (userRow?.is_member) return NextResponse.json({ success: true, already: true });

  /* 2) referral check */
  const { data: refRow, error: refErr } = await supabase
    .from("referrals")
    .select("referrer_address")
    .eq("referred_address", userAddr.toLowerCase())
    .maybeSingle();

  if (refErr) console.error(refErr);

  let refAddr: `0x${string}` | null = null;
  if (refRow?.referrer_address) {
    try {
      const candidate = getAddress(refRow.referrer_address);
      if (candidate !== userAddr) refAddr = candidate;
    } catch {
      /* ignore bad stored address */
    }
  }

  /* 3) determine amounts */
  const newUserAmountNum = refAddr
    ? BASE_REWARD + NEW_USER_BONUS
    : BASE_REWARD;

  const mints: MintTarget[] = [
    { to: userAddr, amount: parseUnits(newUserAmountNum.toString(), 18) },
  ];
  if (refAddr) {
    mints.push({ to: refAddr, amount: parseUnits(REFERRER_BONUS.toString(), 18) });
  }

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

  /* 6) mark as member (even if DB fails, on-chain is final) */
  const { error: upErr } = await supabase
    .from("users")
    .upsert(
      { user_address: userAddr.toLowerCase(), is_member: true },
      { onConflict: "user_address" }
    );
  if (upErr) console.error("upsert users err:", upErr);

  return NextResponse.json({
    success: true,
    already: false,
    awarded: newUserAmountNum.toString(),
    referrerRewarded: Boolean(refAddr),
    txHashes,
  });
}

