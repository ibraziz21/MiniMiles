import { requireActor, UnauthorizedError } from '@/lib/auth/requestActor';
import { apiSuccess, apiError } from '@/lib/api/v1/response';
import { listSavedMerchants } from '@/lib/merchants/savedMerchants';
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const raw = new URL(request.url).searchParams.get('offset') ?? '0';
    if (!/^\d{1,6}$/.test(raw)) return apiError(request, 'INVALID_OFFSET', 'Invalid page.', 400);
    const offset = Number(raw);
    const rows = await listSavedMerchants(actor.userId, { strict: true, offset, limit: 21 });
    const response = apiSuccess(request, { places: rows.slice(0, 20), nextOffset: rows.length > 20 ? offset + 20 : null });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    console.error('[profile-saved-places] read failed', error);
    return apiError(request, 'SAVED_PLACES_UNAVAILABLE', 'Your saved places could not be loaded. Please try again.', 503);
  }
}
