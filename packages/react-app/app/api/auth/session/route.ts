// app/api/auth/session/route.ts
// Returns the current session state. Used by frontend to check if already signed in.

import { requireSession } from "@/lib/auth";

export async function GET() {
  const session = await requireSession();
  if (!session) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  return Response.json({ authenticated: true, walletAddress: session.walletAddress });
}

export async function DELETE() {
  const { getSession } = await import("@/lib/auth");
  const session = await getSession();
  session.destroy();
  return Response.json({ ok: true });
}
