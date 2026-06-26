import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabase } from "@/lib/supabase";
import { getPayoutProvider } from "@/lib/payout/index";

// Public endpoint: provider webhooks. No admin session. Always returns 200 so
// providers do not retry-storm; internal errors are captured as incidents.
export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const rawBody = await req.text();
  const rawBodyHash = createHash("sha256").update(rawBody).digest("hex");

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  let provider;
  try {
    provider = getPayoutProvider(params.provider);
  } catch {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let signatureVerified = false;
  let parsed: {
    providerReference: string;
    status: string;
    amount: number;
    currency: string;
  } | null = null;

  try {
    signatureVerified = provider.verifyCallback(headers, rawBody);
    if (signatureVerified) {
      parsed = provider.parseCallback(rawBody, rawBodyHash);
    }
  } catch {
    signatureVerified = false;
  }

  try {
    await supabase.rpc("process_provider_callback", {
      p_provider_name: provider.name,
      p_raw_body_hash: rawBodyHash,
      p_provider_reference: parsed?.providerReference ?? null,
      p_amount: parsed?.amount ?? null,
      p_currency: parsed?.currency ?? null,
      p_status: parsed?.status ?? "unknown",
      p_signature_verified: signatureVerified,
      p_actor: `webhook:${provider.name}`,
    });
  } catch (e) {
    console.error("[payout/callback]", (e as Error).message);
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
