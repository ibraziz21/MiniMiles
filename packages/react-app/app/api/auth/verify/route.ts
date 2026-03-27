// app/api/auth/verify/route.ts
// Verifies an EIP-191 signed message and creates an iron-session cookie.

import { verifyMessage } from "viem";
import { verifyNonce, getSession } from "@/lib/auth";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { address, message, signature } = body as {
    address?: string;
    message?: string;
    signature?: string;
  };

  if (
    !address || !/^0x[a-fA-F0-9]{40}$/.test(address) ||
    !message || typeof message !== "string" ||
    !signature || !/^0x[a-fA-F0-9]+$/.test(signature)
  ) {
    return Response.json({ error: "address, message, and signature are required" }, { status: 400 });
  }

  const addr = address.toLowerCase();

  // 1. Extract nonce from signed message and verify it
  const nonceMatch = message.match(/^Nonce: ([a-f0-9]{32})$/m);
  if (!nonceMatch) {
    return Response.json({ error: "Malformed message: missing nonce" }, { status: 400 });
  }
  const nonce = nonceMatch[1];

  // verifyNonce checks validity and atomically consumes the nonce (one-time use)
  if (!verifyNonce(addr, nonce)) {
    return Response.json({ error: "Nonce expired or invalid. Please try again." }, { status: 401 });
  }

  // 2. Verify the signature
  let valid: boolean;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return Response.json({ error: "Signature verification failed" }, { status: 401 });
  }

  if (!valid) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. Create session
  const session = await getSession();
  session.walletAddress = addr;
  session.issuedAt = Date.now();
  await session.save();

  return Response.json({ ok: true, walletAddress: addr });
}
