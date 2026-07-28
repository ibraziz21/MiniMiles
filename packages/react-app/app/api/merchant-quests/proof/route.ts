import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  MERCHANT_QUEST_PROOF_DEAL_OPENED,
  MERCHANT_QUEST_PROOF_PASS_OPENED,
  QUEST_AKIBA_PASS,
  QUEST_BROWSE_DEALS,
} from "@/lib/merchantDiscoveryQuests";
import { supabase } from "@/lib/supabaseClient";
import { recordMerchantQuestEvent } from "@/lib/server/merchantQuestAudit";
import { isMerchantQuestEnabledForAddress } from "@/lib/server/merchantQuestRollout";

type ProofBody = {
  questId?: string;
  actionType?: string;
  referenceId?: string;
};

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  if (!isMerchantQuestEnabledForAddress(session.walletAddress)) {
    return NextResponse.json(
      { error: "Merchant quests are not available" },
      { status: 404 },
    );
  }

  let body: ProofBody;
  try {
    body = (await request.json()) as ProofBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const isPassProof =
    body.questId === QUEST_AKIBA_PASS &&
    body.actionType === MERCHANT_QUEST_PROOF_PASS_OPENED;
  const isDealProof =
    body.questId === QUEST_BROWSE_DEALS &&
    body.actionType === MERCHANT_QUEST_PROOF_DEAL_OPENED;

  if (!isPassProof && !isDealProof) {
    return NextResponse.json(
      { error: "Unsupported merchant quest proof" },
      { status: 400 },
    );
  }

  const questId = isPassProof ? QUEST_AKIBA_PASS : QUEST_BROWSE_DEALS;
  const actionType = isPassProof
    ? MERCHANT_QUEST_PROOF_PASS_OPENED
    : MERCHANT_QUEST_PROOF_DEAL_OPENED;
  let actionRef = "phase-1";
  if (isDealProof) {
    const referenceId = body.referenceId?.trim();
    if (!referenceId || referenceId.length > 128) {
      return NextResponse.json(
        { error: "A valid deal reference is required" },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();
    const { data: activeDeal, error: dealError } = await supabase
      .from("spend_voucher_templates")
      .select("id")
      .eq("id", referenceId)
      .eq("active", true)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .maybeSingle();

    if (dealError) {
      console.error("[merchant-quests/proof] deal lookup", dealError);
      return NextResponse.json(
        { error: "Could not verify this deal" },
        { status: 503 },
      );
    }
    if (!activeDeal) {
      return NextResponse.json(
        { error: "Deal is no longer active" },
        { status: 400 },
      );
    }
    actionRef = referenceId;
  }

  const { error } = await supabase
    .from("merchant_quest_action_proofs")
    .upsert(
      {
        user_address: session.walletAddress.toLowerCase(),
        partner_quest_id: questId,
        action_type: actionType,
        action_ref: actionRef,
      },
      {
        onConflict:
          "user_address,partner_quest_id,action_type,action_ref",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    console.error("[merchant-quests/proof] write", error);
    return NextResponse.json(
      { error: "Could not record merchant quest progress" },
      { status: 503 },
    );
  }

  await recordMerchantQuestEvent({
    eventKey: `proof:${session.walletAddress.toLowerCase()}:${questId}:${actionType}:${actionRef}`,
    eventType: "proof_recorded",
    userAddress: session.walletAddress,
    questId,
    metadata: {
      actionType,
      actionRef,
    },
  });

  return NextResponse.json({ recorded: true });
}
