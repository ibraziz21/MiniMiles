// app/api/auth/nonce/route.ts
// Returns a short-lived HMAC nonce for the given wallet address.
// The frontend includes this nonce in the message it asks the user to sign.

import { NextRequest } from "next/server";
import { generateNonce } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return Response.json({ error: "Valid address required" }, { status: 400 });
  }

  const nonce = await generateNonce(address);
  return Response.json({ nonce });
}
