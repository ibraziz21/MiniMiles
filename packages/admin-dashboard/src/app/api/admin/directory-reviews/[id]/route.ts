import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { parseModerationRequest } from "@/lib/merchant-directory-review";
import { supabase } from "@/lib/supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcErrorResponse(error: { code?: string; message?: string }) {
  if (error.code === "P0002") {
    return NextResponse.json({ error: "Merchant profile not found." }, { status: 404 });
  }
  if (error.code === "22023") {
    return NextResponse.json(
      { error: "This action is no longer valid for the profile's current status. Refresh and try again." },
      { status: 409 },
    );
  }
  if (error.code === "23514") {
    return NextResponse.json(
      { error: "This profile is no longer complete. Ask the merchant to finish the required sections." },
      { status: 422 },
    );
  }
  if (error.code === "55000") {
    return NextResponse.json(
      { error: "This merchant account is not active and cannot be published." },
      { status: 409 },
    );
  }

  console.error("[directory-review] transition failed", {
    code: error.code,
    message: error.message,
  });
  return NextResponse.json({ error: "The profile could not be updated." }, { status: 500 });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!UUID_PATTERN.test(params.id)) {
    return NextResponse.json({ error: "Invalid merchant ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = parseModerationRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const actorId = adminIdForWrite(session);
  const { action, affectedSections, merchantSafeMessage, internalNote } = parsed.value;
  const { data, error } = await supabase.rpc("perform_merchant_directory_transition", {
    p_partner_id: params.id,
    p_action: action,
    p_actor_user_id: actorId,
    p_actor_type: "internal_admin",
    p_affected_sections: affectedSections,
    p_merchant_safe_message: merchantSafeMessage,
    p_internal_note: internalNote,
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: actorId,
    action: `merchant.directory.${action}`,
    targetType: "merchant",
    targetId: params.id,
    metadata: {
      affectedSections,
      merchantSafeMessage,
      internalNote,
      resultingStatus:
        data && typeof data === "object" && "status" in data
          ? (data as { status: unknown }).status
          : null,
    },
  });

  return NextResponse.json({ ok: true, directory: data });
}
