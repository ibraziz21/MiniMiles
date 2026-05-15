import { erc20Abi, formatUnits, parseUnits } from "viem";
import { celoClient } from "@/lib/celoClient";
import { getQuest } from "@/lib/questRegistry";
import { fetchSuperAccountForOwner } from "@/lib/prosperity-pass";
import { supabase } from "@/lib/supabaseClient";
import type {
  RaffleRequirementGateResult,
  RaffleRequirementGateType,
  RaffleRequirementMode,
  RaffleRequirementsResult,
} from "@/types/raffleRequirements";

type RaffleRequirementGate =
  | { type: "min_usdt_balance"; minUsd: number }
  | { type: "prosperity_pass_holder" }
  | { type: "daily_5tx_completed" };

type RaffleRequirementConfig = {
  mode: RaffleRequirementMode;
  gates: RaffleRequirementGate[];
};

const USDT_ADDRESS = (
  process.env.NEXT_PUBLIC_USDT_ADDRESS ??
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
) as `0x${string}`;

const USDT_DECIMALS = 6;

function parseRequirementMode(mode: unknown): RaffleRequirementMode {
  return mode === "any" ? "any" : "all";
}

function parseGate(raw: unknown): RaffleRequirementGate | null {
  if (!raw || typeof raw !== "object") return null;
  const gate = raw as Record<string, unknown>;

  if (gate.type === "min_usdt_balance") {
    const minUsd = Number(gate.minUsd ?? gate.min_usd ?? 10);
    if (!Number.isFinite(minUsd) || minUsd <= 0) return null;
    return { type: "min_usdt_balance", minUsd };
  }

  if (gate.type === "prosperity_pass_holder") {
    return { type: "prosperity_pass_holder" };
  }

  if (gate.type === "daily_5tx_completed") {
    return { type: "daily_5tx_completed" };
  }

  return null;
}

function parseRequirementConfig(row: {
  mode: unknown;
  gates: unknown;
}): RaffleRequirementConfig | null {
  if (!Array.isArray(row.gates)) return null;
  const gates = row.gates.map(parseGate).filter((gate): gate is RaffleRequirementGate => !!gate);
  if (gates.length === 0) return null;
  return {
    mode: parseRequirementMode(row.mode),
    gates,
  };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function gateLabel(type: RaffleRequirementGateType, minUsd?: number) {
  if (type === "min_usdt_balance") return `Hold at least ${minUsd ?? 10} USDT`;
  if (type === "prosperity_pass_holder") return "Hold a Prosperity Pass";
  return "Complete today's 5-transfer quest";
}

function gateMessage(result: RaffleRequirementGateResult) {
  if (result.status === "passed") return undefined;
  if (result.type === "min_usdt_balance") {
    return `Hold at least ${result.required} in wallet USDT to enter this raffle.`;
  }
  if (result.type === "prosperity_pass_holder") {
    return "Claim your Prosperity Pass to enter this raffle.";
  }
  return "Complete today's 5-transfer quest to enter this raffle.";
}

async function evaluateMinUsdtBalance(
  userAddress: string,
  minUsd: number,
): Promise<RaffleRequirementGateResult> {
  const raw = await celoClient.readContract({
    address: USDT_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [userAddress as `0x${string}`],
  });
  const requiredRaw = parseUnits(String(minUsd), USDT_DECIMALS);
  const status = raw >= requiredRaw ? "passed" : "failed";
  const current = Number(formatUnits(raw, USDT_DECIMALS)).toFixed(2);
  const result: RaffleRequirementGateResult = {
    type: "min_usdt_balance",
    label: gateLabel("min_usdt_balance", minUsd),
    status,
    current: `${current} USDT`,
    required: `${minUsd} USDT`,
  };
  return { ...result, message: gateMessage(result) };
}

async function evaluateProsperityPass(
  userAddress: string,
): Promise<RaffleRequirementGateResult> {
  const { hasPassport } = await fetchSuperAccountForOwner(userAddress);
  const status = hasPassport ? "passed" : "failed";
  const result: RaffleRequirementGateResult = {
    type: "prosperity_pass_holder",
    label: gateLabel("prosperity_pass_holder"),
    status,
    current: hasPassport ? "Pass found" : "No pass found",
    required: "Prosperity Pass",
  };
  return { ...result, message: gateMessage(result) };
}

async function hasQueuedDaily5Tx(userLc: string, questId: string, claimedAt: string) {
  const { data, error } = await supabase
    .from("minipoint_mint_jobs")
    .select("id")
    .eq("user_address", userLc)
    .in("status", ["pending", "processing", "completed"])
    .contains("payload", {
      kind: "daily_engagement",
      userAddress: userLc,
      questId,
      claimedAt,
    })
    .limit(1);

  if (error) throw error;
  return !!data?.length;
}

async function evaluateDaily5TxCompleted(
  userAddress: string,
): Promise<RaffleRequirementGateResult> {
  const userLc = userAddress.toLowerCase();
  const quest = getQuest("daily_5tx");
  const today = todayKey();

  const { data: completed, error } = await supabase
    .from("daily_engagements")
    .select("id")
    .eq("user_address", userLc)
    .eq("quest_id", quest.questId)
    .eq("claimed_at", today)
    .maybeSingle();

  if (error) throw error;

  const queued = completed ? false : await hasQueuedDaily5Tx(userLc, quest.questId, today);
  const passed = !!completed || queued;
  const result: RaffleRequirementGateResult = {
    type: "daily_5tx_completed",
    label: gateLabel("daily_5tx_completed"),
    status: passed ? "passed" : "failed",
    current: completed ? "Completed" : queued ? "Queued" : "Not completed",
    required: "5-transfer quest today",
  };
  return { ...result, message: gateMessage(result) };
}

async function evaluateGate(
  userAddress: string,
  gate: RaffleRequirementGate,
): Promise<RaffleRequirementGateResult> {
  if (gate.type === "min_usdt_balance") {
    return evaluateMinUsdtBalance(userAddress, gate.minUsd);
  }
  if (gate.type === "prosperity_pass_holder") {
    return evaluateProsperityPass(userAddress);
  }
  return evaluateDaily5TxCompleted(userAddress);
}

export async function getRaffleRequirementConfig(roundId: number) {
  const { data, error } = await supabase
    .from("raffle_requirements")
    .select("mode,gates")
    .eq("round_id", roundId)
    .eq("enabled", true)
    .maybeSingle();

  if (error) throw error;
  return data ? parseRequirementConfig(data) : null;
}

export async function evaluateRaffleRequirements(
  roundId: number,
  userAddress?: string,
): Promise<RaffleRequirementsResult> {
  const config = await getRaffleRequirementConfig(roundId);
  if (!config) {
    return { roundId, gated: false, eligible: true, mode: "all", gates: [] };
  }

  if (!userAddress) {
    return {
      roundId,
      gated: true,
      eligible: null,
      mode: config.mode,
      gates: [],
      message: "Connect and sign in to check raffle requirements.",
    };
  }

  const gates = await Promise.all(
    config.gates.map((gate) => evaluateGate(userAddress, gate)),
  );
  const eligible =
    config.mode === "all"
      ? gates.every((gate) => gate.status === "passed")
      : gates.some((gate) => gate.status === "passed");

  return {
    roundId,
    gated: true,
    eligible,
    mode: config.mode,
    gates,
    message: eligible
      ? undefined
      : gates.find((gate) => gate.status === "failed")?.message,
  };
}
