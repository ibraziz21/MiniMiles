// /api/v1/me/welcome-offer — the new-member welcome offer (docs/BDR-008).
//
//   GET  — the member's existing offer, or { state: "none" }. Never enrols.
//   POST — enrols the member if they qualify and returns the offer; a repeat
//          call returns the same offer with its original expiry.
//
// The app calls POST when the member reaches the last onboarding step, and
// shows the voucher only when the answer is `awarded` — a committed voucher,
// never a promise. Enrolment is native-app only (BDR-008 §4): a bearer token
// is how the app authenticates, the web uses a cookie. That is the limit of
// what the server can tell; it cannot prove a physical app install.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { enrolWelcomeOffer, getWelcomeOffer, type WelcomeOffer } from "@/lib/akiba/welcomeOffer";

export const dynamic = "force-dynamic";

function respond(request: Request, welcomeOffer: WelcomeOffer) {
  const response = apiSuccess(request, { welcomeOffer });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }
  return respond(request, await getWelcomeOffer(actor.userId));
}

export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  if (actor.authMode !== "bearer") {
    // A web member may still have one from the app; they just can't enrol here.
    const existing = await getWelcomeOffer(actor.userId);
    return respond(request, existing.state === "none" ? { state: "unavailable", reason: "unsupported_channel" } : existing);
  }

  return respond(request, await enrolWelcomeOffer(actor.userId));
}
