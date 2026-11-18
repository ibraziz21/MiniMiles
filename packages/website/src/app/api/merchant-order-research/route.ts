import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { merchantInviteId, questions, sections, surveyCohorts, validateStep, type Answers } from "@/lib/merchant-order-research";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 20_000) return NextResponse.json({ error: "Response is too long." }, { status: 413 });

  let body: { answers?: Answers; website?: unknown; id?: unknown; merchantId?: unknown; cohort?: unknown; language?: unknown } | null;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (typeof body?.website === "string" && body.website.trim()) return NextResponse.json({ ok: true });

  const answers = body?.answers;
  const id = body?.id;
  if (!answers || typeof answers !== "object" || Array.isArray(answers) ||
      typeof id !== "string" || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid survey response." }, { status: 400 });
  }

  const cleanAnswers: Answers = { language: body?.language === "sw" ? "sw" : "en" };
  const merchantId = merchantInviteId(body?.merchantId);
  if (merchantId) cleanAnswers.merchantId = merchantId;
  if (typeof body?.cohort === "string" && surveyCohorts.includes(body.cohort)) {
    cleanAnswers.cohort = body.cohort;
  }
  for (let step = 0; step < sections.length; step++) {
    if (validateStep(step, answers)) {
      return NextResponse.json({ error: "Check your answers and try again." }, { status: 400 });
    }
    for (const { key } of questions(step, answers)) {
      if (key === "business" && merchantId) continue;
      const answer = answers[key];
      if (Array.isArray(answer)) cleanAnswers[key] = answer;
      else if (typeof answer === "string" && answer.trim()) cleanAnswers[key] = answer.trim();
    }
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "Response storage is temporarily unavailable." }, { status: 503 });

  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await supabase.from("merchant_order_research_responses").upsert(
      { id, answers: cleanAnswers },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
  } catch {
    return NextResponse.json({ error: "We couldn’t save your response. Please try again." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
