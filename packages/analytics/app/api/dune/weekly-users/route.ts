import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/auth";

const DUNE_API_BASE = "https://api.dune.com/api/v1";
const DEFAULT_QUERY_ID = "5668123";
const DEFAULT_VALUE_COLUMN = "users";
const DEFAULT_TIMELINE_COLUMN = "timeline";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asDateString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export async function GET(request: NextRequest) {
  if (!checkApiAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const apiKey = process.env.DUNE_API_KEY;
    const queryId = process.env.DUNE_WAU_QUERY_ID || DEFAULT_QUERY_ID;
    const valueColumn = process.env.DUNE_WAU_COLUMN || DEFAULT_VALUE_COLUMN;
    const timelineColumn =
      process.env.DUNE_WAU_TIMELINE_COLUMN || DEFAULT_TIMELINE_COLUMN;

    if (!apiKey) {
      return NextResponse.json(
        { error: "DUNE_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const url = `${DUNE_API_BASE}/query/${queryId}/results?limit=1000&api_key=${encodeURIComponent(
      apiKey
    )}`;

    const upstream = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: "Dune request failed", status: upstream.status, detail: text },
        { status: 502 }
      );
    }

    const json = await upstream.json();
    const rows = Array.isArray(json?.result?.rows) ? json.result.rows : [];

    const normalized = rows
      .map((row: Record<string, unknown>) => ({
        timeline: asDateString(row[timelineColumn]),
        users: asNumber(row[valueColumn]),
        raw: row,
      }))
      .filter(
        (row: {
          timeline: string | null;
          users: number | null;
          raw: Record<string, unknown>;
        }) => row.timeline && row.users !== null
      )
      .sort(
        (
          a: { timeline: string | null; users: number | null },
          b: { timeline: string | null; users: number | null }
        ) => String(a.timeline).localeCompare(String(b.timeline))
      );

    const latest = normalized[normalized.length - 1] ?? null;

    return NextResponse.json({
      queryId: Number(queryId),
      valueColumn,
      timelineColumn,
      latestValue: latest?.users ?? null,
      latestTimeline: latest?.timeline ?? null,
      executionId: json?.execution_id ?? null,
      state: json?.state ?? null,
      submittedAt: json?.submitted_at ?? null,
      expiresAt: json?.expires_at ?? null,
      rows: normalized.map((row: { timeline: string | null; users: number | null }) => ({
        timeline: row.timeline,
        users: row.users,
      })),
      metadata: json?.result?.metadata ?? null,
    });
  } catch (error: any) {
    console.error("[analytics/dune/weekly-users]", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
