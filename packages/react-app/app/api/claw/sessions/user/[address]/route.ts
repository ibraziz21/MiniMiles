// GET /api/claw/sessions/user/[address]
// Returns known Claw session IDs for the authenticated wallet.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  CLAW_SESSIONS_SETUP_MESSAGE,
  isClawSessionsSetupError,
  listClawSessionsForPlayer,
} from "@/lib/server/clawSessions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const appSession = await requireSession();
    if (!appSession) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { address: rawAddress } = await params;
    const address = rawAddress?.toLowerCase();
    if (!address) {
      return NextResponse.json({ error: "address required" }, { status: 400 });
    }
    if (address !== appSession.walletAddress.toLowerCase()) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { sessions, error } = await listClawSessionsForPlayer(address, 75);
    if (error) {
      if (isClawSessionsSetupError(error)) {
        return NextResponse.json({
          sessions: [],
          setupRequired: true,
          error: CLAW_SESSIONS_SETUP_MESSAGE,
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sessions });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
