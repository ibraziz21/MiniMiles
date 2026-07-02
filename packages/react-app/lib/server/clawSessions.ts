/**
 * Server-only helpers for MiniMiles' local Claw session index.
 *
 * The Claw contract remains the source of truth. This table only stores the
 * session IDs we need so the app does not discover user sessions by scanning
 * logs in the browser.
 */

import { supabase } from "@/lib/supabaseClient";

export const GAME_STARTED_EVENT = {
  name: "GameStarted",
  type: "event" as const,
  inputs: [
    { indexed: true,  name: "sessionId",    type: "uint256" },
    { indexed: true,  name: "player",       type: "address" },
    { indexed: true,  name: "tierId",       type: "uint8" },
    { indexed: false, name: "playCost",     type: "uint256" },
    { indexed: false, name: "requestBlock", type: "uint256" },
  ],
};

export type ClawSessionIndexRow = {
  sessionId: string;
  player: string;
  tierId: number;
  txHash: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type UpsertInput = {
  sessionId: string;
  player: string;
  tierId: number;
  txHash?: string | null;
};

export function isClawSessionsSetupError(error: any) {
  const code = String(error?.code ?? "");
  const message = [
    error?.message,
    error?.details,
    error?.hint,
  ].filter(Boolean).join(" ").toLowerCase();

  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (
      message.includes("claw_sessions") &&
      (
        message.includes("does not exist") ||
        message.includes("could not find") ||
        message.includes("schema cache") ||
        message.includes("permission denied")
      )
    )
  );
}

export const CLAW_SESSIONS_SETUP_MESSAGE =
  "claw_sessions table is not available. Run packages/react-app/sql/claw_sessions.sql in Supabase.";

function normalizeRow(row: any): ClawSessionIndexRow {
  return {
    sessionId: String(row.session_id),
    player: String(row.player),
    tierId: Number(row.tier_id),
    txHash: row.tx_hash ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function upsertClawSession(input: UpsertInput) {
  const now = new Date().toISOString();
  const row: Record<string, string | number | null> = {
    session_id: input.sessionId,
    player: input.player.toLowerCase(),
    tier_id: input.tierId,
    updated_at: now,
  };

  if (input.txHash !== undefined) {
    row.tx_hash = input.txHash;
  }

  const { data, error } = await supabase
    .from("claw_sessions")
    .upsert(row, { onConflict: "session_id" })
    .select("session_id, player, tier_id, tx_hash, created_at, updated_at")
    .single();

  return {
    row: data ? normalizeRow(data) : null,
    error,
  };
}

export async function listClawSessionsForPlayer(player: string, limit = 50) {
  const { data, error } = await supabase
    .from("claw_sessions")
    .select("session_id, player, tier_id, tx_hash, created_at, updated_at")
    .eq("player", player.toLowerCase())
    .order("created_at", { ascending: false })
    .limit(limit);

  return {
    sessions: (data ?? []).map(normalizeRow),
    error,
  };
}

export async function listRecentClawSessions(limit = 500) {
  const { data, error } = await supabase
    .from("claw_sessions")
    .select("session_id, player, tier_id, tx_hash, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);

  return {
    sessions: (data ?? []).map(normalizeRow),
    error,
  };
}
