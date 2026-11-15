import { requireActor, UnauthorizedError } from '@/lib/auth/requestActor';
import { apiSuccess, apiError } from '@/lib/api/v1/response';
import { resolveHubProfile } from '@/lib/akiba/hubProfile';
import { getRecentActivity } from '@/lib/akiba/activity';

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const profile = await resolveHubProfile({ userId: actor.userId, email: actor.email });
    const items = await getRecentActivity({ userId: actor.userId, email: actor.email, walletAddress: profile.walletAddress, limit: 100, strict: true });
    const response = apiSuccess(request, { items, limit: 100 });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    console.error('[profile-activity] read failed', error);
    return apiError(request, 'ACTIVITY_UNAVAILABLE', 'Your activity could not be loaded. Please try again.', 503);
  }
}
