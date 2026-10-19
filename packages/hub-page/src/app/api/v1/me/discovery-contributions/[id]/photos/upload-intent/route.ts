import { apiError, apiSuccess } from "@/lib/api/v1/response";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  createDiscoveryPhotoUploadIntent,
  DiscoveryPhotoError,
} from "@/lib/discovery/photoUploads";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return apiError(request, "INVALID_ID", "Invalid contribution", 400);

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

  const body = await request.json().catch(() => null);
  try {
    const intent = await createDiscoveryPhotoUploadIntent({
      contributionId: params.id,
      userId: actor.userId,
      contentType: typeof body?.contentType === "string" ? body.contentType : "",
      consentVersion: typeof body?.consentVersion === "string" ? body.consentVersion : "",
    });
    return apiSuccess(request, intent);
  } catch (error) {
    if (error instanceof DiscoveryPhotoError) {
      return apiError(request, error.code.toUpperCase(), error.message, error.status, { retryable: error.retryable });
    }
    throw error;
  }
}
