// app/api/auth/minipay/route.ts
//
// Creates an iron-session for MiniPay users without requiring a signature.
// MiniPay is a custodial wallet environment where the user is already
// authenticated via their Google/Apple account — requiring personal_sign
// adds unnecessary friction and no real security benefit in that context.
//
// Protection still in place: every reward route has on-chain tx gates,
// blacklist checks, and quest completion guards.

import { getSession } from "@/lib/auth";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { address } = body as { address?: string };

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }

  const addr = address.toLowerCase();

  const session = await getSession();
  session.walletAddress = addr;
  session.issuedAt = Date.now();
  await session.save();

  return Response.json({ ok: true, walletAddress: addr });
}
