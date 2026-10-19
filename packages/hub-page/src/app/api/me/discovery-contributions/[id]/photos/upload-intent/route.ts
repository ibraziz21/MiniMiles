// POST /api/me/discovery-contributions/:contributionId/photos/upload-intent
// Creates a short-lived, owner-bound upload intent into the PRIVATE source bucket
// (verified-discovery-acquisition-v1-spec.md §11.2, §13.2, §17). The object
// is never public: a scheduled worker (process-photo-jobs) must validate,
// strip EXIF/GPS and re-encode it before it can even reach `pending`
// moderation, let alone `approved`.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/push/origin";
import {
  createDiscoveryPhotoUploadIntent,
  DiscoveryPhotoError,
} from "@/lib/discovery/photoUploads";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";
  const consentVersion = typeof body?.consentVersion === "string" ? body.consentVersion : "";
  try {
    return NextResponse.json(await createDiscoveryPhotoUploadIntent({
      contributionId: params.id,
      userId: user.id,
      contentType,
      consentVersion,
    }));
  } catch (error) {
    if (error instanceof DiscoveryPhotoError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
