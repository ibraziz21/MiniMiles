import { requireActor, UnauthorizedError } from '@/lib/auth/requestActor';
import { apiSuccess, apiError } from '@/lib/api/v1/response';
import { createAdminClient } from '@/lib/supabase/admin';
import { summarizeMemberPhotoState } from '@/lib/merchants/memberVisits';
import { extractPublicExperienceLabels } from '@/lib/discovery/publicExperienceLabels';
import { isDiscoveryContributionsEnabledFor } from '@/lib/akiba/discoveryContributionsRollout';

type Merchant = { name: string; slug: string; image_url: string | null };
type Contribution = { id: string; request_id: string; submitted_at: string; would_recommend: boolean | null; experience_option_ids: string[]; partners: Merchant | Merchant[] | null; discovery_contribution_requests: { template_snapshot: unknown } | { template_snapshot: unknown }[] | null };
const one = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const rawOffset = new URL(request.url).searchParams.get('offset') ?? '0';
    if (!/^\d{1,6}$/.test(rawOffset)) return apiError(request, 'INVALID_OFFSET', 'Invalid page.', 400);
    const offset = Number(rawOffset);
    const admin = createAdminClient();
    const [contributions, opportunities] = await Promise.all([
      admin.from('merchant_discovery_contributions')
        .select('id, request_id, submitted_at, would_recommend, experience_option_ids, partners(name, slug, image_url), discovery_contribution_requests(template_snapshot)')
        .eq('hub_user_id', actor.userId).is('withdrawn_at', null)
        .order('submitted_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 20),
      isDiscoveryContributionsEnabledFor(actor.userId)
        ? admin.from('discovery_contribution_requests').select('id, expires_at, partners(name, slug)')
          .eq('hub_user_id', actor.userId).eq('state', 'open').gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }).limit(10)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (contributions.error) throw contributions.error;
    if (opportunities.error) throw opportunities.error;
    const rows = (contributions.data ?? []).slice(0, 20) as unknown as Contribution[];
    const ids = rows.map(row => row.id);
    const [photos, items, publicRows] = ids.length ? await Promise.all([
      admin.from('merchant_visit_photos').select('id, contribution_id, moderation_status, thumbnail_key')
        .eq('hub_user_id', actor.userId).in('contribution_id', ids).is('withdrawn_at', null),
      admin.from('merchant_discovery_contribution_items').select('contribution_id, merchant_discovery_item_mentions!inner(raw_label, hub_user_id)')
        .in('contribution_id', ids).eq('merchant_discovery_item_mentions.hub_user_id', actor.userId),
      admin.from('eligible_public_discovery_contributions').select('contribution_id').in('contribution_id', ids),
    ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
    if (publicRows.error) throw publicRows.error;
    const publicIds = new Set((publicRows.data ?? []).map(row => row.contribution_id));
    if (photos.error) throw photos.error;
    if (items.error) throw items.error;
    // Only processed derivatives, never the original upload. These URLs are
    // returned to the owning member only and expire after five minutes.
    const keys = (photos.data ?? []).flatMap(photo => photo.thumbnail_key ? [photo.thumbnail_key as string] : []);
    const signed = keys.length ? await admin.storage.from('discovery-visit-photos-derived').createSignedUrls(keys, 300) : null;
    const urls = new Map((signed?.data ?? []).map(photo => [photo.path, photo.signedUrl]));
    const shares = rows.map(row => {
      const merchant = one(row.partners);
      const ownPhotos = (photos.data ?? []).filter(photo => photo.contribution_id === row.id);
      return {
        publiclyVisible: publicIds.has(row.id),
        id: row.id, requestId: row.request_id, submittedAt: row.submitted_at,
        merchantName: merchant?.name ?? 'Merchant', merchantSlug: merchant?.slug ?? '', merchantLogoUrl: merchant?.image_url ?? null,
        recommendation: row.would_recommend === true ? 'recommended' : row.would_recommend === false ? 'not_recommended' : 'skipped',
        photoState: summarizeMemberPhotoState(ownPhotos),
        items: (items.data ?? []).filter(item => item.contribution_id === row.id).flatMap(item => {
          const mention = one(item.merchant_discovery_item_mentions); return mention ? [mention.raw_label] : [];
        }),
        experienceLabels: extractPublicExperienceLabels(one(row.discovery_contribution_requests)?.template_snapshot, row.experience_option_ids),
        photos: ownPhotos.map(photo => ({ id: photo.id, status: photo.moderation_status, url: urls.get(photo.thumbnail_key) ?? null })),
      };
    });
    const response = apiSuccess(request, {
      shares, nextOffset: (contributions.data?.length ?? 0) > 20 ? offset + 20 : null,
      opportunities: (opportunities.data ?? []).flatMap(row => {
        const merchant = one(row.partners);
        return merchant ? [{ id: row.id, merchantName: merchant.name, merchantSlug: merchant.slug, expiresAt: row.expires_at }] : [];
      }),
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(request, error.code, error.message, error.status);
    console.error('[profile-shares] read failed', error);
    return apiError(request, 'SHARES_UNAVAILABLE', 'Your shares could not be loaded. Please try again.', 503);
  }
}
