import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  completeDiscoveryPhotoUpload,
  DiscoveryPhotoError,
} from "@/lib/discovery/photoUploads";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: { id: string; photoId: string } },
) {
  if (!UUID_RE.test(params.id) || !UUID_RE.test(params.photoId)) {
    return apiError(request, "INVALID_ID", "Invalid photo", 400);
  }

  let actor;
  try {
    actor = await requireActor(request);
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  try {
    const result = await completeDiscoveryPhotoUpload({
      contributionId: params.id,
      photoId: params.photoId,
      userId: actor.userId,
    });
    return apiSuccess(request, result, { status: result.status === "processing" ? 202 : 200 });
  } catch (error) {
    if (error instanceof DiscoveryPhotoError) {
      return apiError(request, error.code.toUpperCase(), error.message, error.status, { retryable: error.retryable });
    }
    throw error;
  }
}
