import { NextResponse } from "next/server";
import { FarkleStateError, getFarkleTurnState } from "@/server/farkle/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ matchId: string }> };

const POLL_MS = Number(process.env.FARKLE_SSE_POLL_MS ?? "1000") || 1000;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = Number(process.env.FARKLE_SSE_MAX_STREAM_MS ?? "600000") || 600_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sseData(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: Request, { params }: Ctx) {
  const { matchId } = await params;
  const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        closed = true;
        try {
          controller.close();
        } catch {}
      };

      req.signal.addEventListener("abort", close, { once: true });

      let lastSignature = "";
      let lastHeartbeat = 0;

      while (!closed && Date.now() - startedAt < MAX_STREAM_MS) {
        try {
          const state = await getFarkleTurnState(matchId, address);
          const signature = JSON.stringify(state);
          if (signature !== lastSignature) {
            enqueue(sseData(state));
            lastSignature = signature;
          }
        } catch (err) {
          const status = err instanceof FarkleStateError ? err.status : 500;
          const message = err instanceof Error ? err.message : "state unavailable";
          enqueue(sseData({ error: message, status }));
          if (status === 404) break;
        }

        if (Date.now() - lastHeartbeat > HEARTBEAT_MS) {
          enqueue(": heartbeat\n\n");
          lastHeartbeat = Date.now();
        }

        await sleep(POLL_MS);
      }

      close();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
