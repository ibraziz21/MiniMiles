import { NextResponse } from "next/server";
import {
  farkleBackendHeaders,
  missingBackendSecret,
  proxyFarkleBackend,
} from "@/app/api/games/farkle/_backend";

const ADMIN_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

function isAuthorized(req: Request, bodySecret?: string | null) {
  if (!ADMIN_SECRET) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${ADMIN_SECRET}`) return true;
  const querySecret = new URL(req.url).searchParams.get("secret");
  return querySecret === ADMIN_SECRET || bodySecret === ADMIN_SECRET;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = farkleBackendHeaders();
  if (!headers) return missingBackendSecret();

  const { searchParams } = new URL(req.url);
  const upstream = new URLSearchParams();
  const status = searchParams.get("status");
  const limit = searchParams.get("limit");
  if (status) upstream.set("status", status);
  if (limit) upstream.set("limit", limit);

  return proxyFarkleBackend(
    `/games/farkle/admin/recovery${upstream.size ? `?${upstream.toString()}` : ""}`,
    { headers, cache: "no-store" },
    20_000,
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!isAuthorized(req, typeof body?.secret === "string" ? body.secret : null)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = farkleBackendHeaders(true);
  if (!headers) return missingBackendSecret();

  const action = body?.action;
  if (action === "run") {
    return proxyFarkleBackend(
      "/games/farkle/admin/recovery/run",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ limit: body?.limit }),
      },
      60_000,
    );
  }

  if (action === "retry") {
    return proxyFarkleBackend(
      "/games/farkle/admin/recovery/retry",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId: body?.jobId, matchId: body?.matchId }),
      },
      60_000,
    );
  }

  return NextResponse.json({ error: "invalid action" }, { status: 400 });
}
