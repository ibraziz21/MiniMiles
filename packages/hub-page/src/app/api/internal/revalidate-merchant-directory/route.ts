import { timingSafeEqual } from "crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RevalidationBody = {
  partnerId?: unknown;
  slug?: unknown;
  reason?: unknown;
  version?: unknown;
};

function secretsMatch(received: string | null, expected: string): boolean {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSlug(value: unknown): value is string {
  return typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 120 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export async function POST(request: Request) {
  const expectedSecret = process.env.DIRECTORY_REVALIDATION_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "revalidation_not_configured" }, { status: 503 });
  }
  if (!secretsMatch(request.headers.get("x-directory-revalidation-secret"), expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: RevalidationBody;
  try {
    body = await request.json() as RevalidationBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isUuid(body.partnerId)) {
    return NextResponse.json({ error: "invalid_partner_id" }, { status: 400 });
  }
  if (body.slug !== null && body.slug !== undefined && !isSlug(body.slug)) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }
  if (typeof body.reason !== "string" || body.reason.length < 1 || body.reason.length > 120) {
    return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
  }
  if (
    body.version !== null &&
    body.version !== undefined &&
    (
      typeof body.version !== "string" ||
      !Number.isFinite(Date.parse(body.version))
    )
  ) {
    return NextResponse.json({ error: "invalid_version" }, { status: 400 });
  }

  // Directory pages are currently force-dynamic, so these calls are cheap
  // acknowledgements today and make the outbox contract future-safe if the
  // list/detail pages later adopt tagged or route caching.
  revalidatePath("/merchants", "page");
  revalidatePath("/api/merchants", "page");
  if (body.slug) {
    revalidatePath(`/merchants/${body.slug}`, "page");
    revalidatePath(`/api/merchants/${body.slug}`, "page");
  }

  return NextResponse.json({
    ok: true,
    partnerId: body.partnerId,
    slug: body.slug ?? null,
  });
}
