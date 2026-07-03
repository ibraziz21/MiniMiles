import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
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

  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const wallet = session.walletAddress.toLowerCase();

  // Pre-flight: verify participant and fetch initial state before opening the stream.
  // This ensures non-participants get a proper 403 HTTP response rather than an error SSE event.
  let initialState;
  try {
    initialState = await getFarkleTurnState(matchId, wallet);
  } catch (err) {
    const status = err instanceof FarkleStateError ? err.status : 500;
    const message = err instanceof Error ? err.message : "state unavailable";
    return NextResponse.json({ error: message }, { status });
  }

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

      // Send the pre-flight state as the first event so the client gets data immediately.
      let lastSignature = JSON.stringify(initialState);
      enqueue(sseData(initialState));
      let lastHeartbeat = Date.now();

      while (!closed && Date.now() - startedAt < MAX_STREAM_MS) {
        await sleep(POLL_MS);

        try {
          const state = await getFarkleTurnState(matchId, wallet);
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
