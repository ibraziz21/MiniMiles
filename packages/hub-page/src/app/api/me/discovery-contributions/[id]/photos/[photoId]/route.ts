// DELETE /api/me/discovery-contributions/:contributionId/photos/:photoId
// Photo consent/status is independently revocable (§8.5) — withdrawing one
// photo never requires withdrawing the structured contribution.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSameOriginRequest } from "@/lib/push/origin";
import { DiscoveryPhotoError, withdrawDiscoveryPhoto } from "@/lib/discovery/photoUploads";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(req: Request, { params }: { params: { id: string; photoId: string } }) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.photoId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await withdrawDiscoveryPhoto({
      contributionId: params.id,
      photoId: params.photoId,
      userId: user.id,
    }));
  } catch (error) {
    if (error instanceof DiscoveryPhotoError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }
}
