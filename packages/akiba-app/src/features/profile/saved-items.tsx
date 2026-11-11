import { useCallback, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { MaterialIcon } from '@/design-system';
import type { SavedMerchant } from '@/contracts';
import { loadOfferLibrary, removeLikedOffer, saveLikedOffer, type SavedOffer } from '@/lib/profile-offer-library';
import { loadOfferDecisionState, saveOfferDecisionState } from '@/lib/offer-decision-storage';
import { removeOfferDecision } from '@/lib/offer-decisions';
import { ProfileReminders } from './reminders';
import { Action, Card, Loading, Notice, Pills, palette, ui } from './ui';
import { useProfileResource } from './use-profile-resource';

export function SavedItems({ refresh }: { refresh: number }) {
  const [tab, setTab] = useState<'places' | 'offers' | 'reminders'>('places');
  return <View><Pills value={tab} onChange={setTab} options={[{ value: 'places', label: 'Places' }, { value: 'offers', label: 'Offers' }, { value: 'reminders', label: 'Reminders' }]} />{tab === 'places' ? <SavedPlaces refresh={refresh} /> : tab === 'offers' ? <LikedOffers refresh={refresh} /> : <ProfileReminders refresh={refresh} />}</View>;
}
function SavedPlaces({ refresh }: { refresh: number }) {
  const { accessToken } = useAuth();
  const { data, setData, loading, error, reload } = useProfileResource(useCallback(async () => {
    void refresh; return createApiClient({ accessToken }).getSavedPlaces();
  }, [accessToken, refresh]));
  const [pending, setPending] = useState<string | null>(null);
  const [removed, setRemoved] = useState<SavedMerchant | null>(null);
  const [failed, setFailed] = useState(false);
  async function toggle(merchant: SavedMerchant, save: boolean) {
    if (pending) return; setPending(merchant.id); setFailed(false);
    try {
      const client = createApiClient({ accessToken });
      if (save) await client.saveMerchant(merchant.slug); else await client.unsaveMerchant(merchant.slug);
      setData(current => current ? { ...current, nextOffset: current.nextOffset == null ? null : current.nextOffset + (save ? 1 : -1), places: save ? [merchant, ...current.places.filter(item => item.id !== merchant.id)] : current.places.filter(item => item.id !== merchant.id) } : null);
      setRemoved(save ? null : merchant);
    } catch { setFailed(true); } finally { setPending(null); }
  }
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  async function more() {
    if (data?.nextOffset == null || moreLoading) return;
    setMoreLoading(true); setMoreError(false);
    try {
      const next = await createApiClient({ accessToken }).getSavedPlaces(data.nextOffset);
      setData(current => current ? { ...next, places: [...current.places, ...next.places.filter(item => !current.places.some(old => old.id === item.id))] } : next);
    } catch { setMoreError(true); } finally { setMoreLoading(false); }
  }
  return <View style={ui.stack}><Text style={ui.heading}>Saved places</Text>
    {loading && !data ? <Loading /> : null}{error ? <Notice error title="Couldn't load saved places" action="Retry" onAction={reload} /> : null}
    {failed ? <Notice error title="Couldn't update this place" body="Your saved places haven't changed. Try the bookmark again." /> : null}
    {removed ? <View style={ui.row}><Text style={[ui.body, ui.flex]}>Place removed</Text><Action label="Undo" disabled={!!pending} onPress={() => void toggle(removed, true)} /></View> : null}
    {data?.places.map(merchant => <View key={merchant.id} style={[ui.card, ui.row, { backgroundColor: '#fff' }]}><Pressable accessibilityRole="button" onPress={() => router.push(`/merchants/${merchant.slug}`)} style={[ui.row, ui.flex]}><View style={ui.icon}>{merchant.logoUrl ? <Image source={merchant.logoUrl} style={{ width: 36, height: 36 }} contentFit="contain" /> : <MaterialIcon name="storefront-outline" color={palette.teal} size={24} />}</View><Text style={[ui.title, ui.flex]}>{merchant.name}</Text></Pressable><Pressable disabled={!!pending} accessibilityRole="button" accessibilityLabel={`Remove ${merchant.name} from saved places`} onPress={() => void toggle(merchant, false)} style={ui.action}><MaterialIcon name="bookmark" size={23} color={palette.teal} /></Pressable></View>)}
    {moreError ? <Notice error title="Couldn't load more places" action="Retry" onAction={more} /> : data?.nextOffset != null ? <Action label={moreLoading ? 'Loading…' : 'Load more'} disabled={moreLoading} onPress={more} /> : null}
    {!loading && !error && data?.places.length === 0 ? <Notice title="No places saved yet" body="Bookmark a place to find it here later." action="Explore places" onAction={() => router.push('/merchants')} /> : null}
  </View>;
}
function LikedOffers({ refresh }: { refresh: number }) {
  const { session, accessToken } = useAuth();
  const scope = session?.user.id ?? 'guest';
  const { data, setData, loading, error, reload } = useProfileResource(useCallback(async () => {
    void refresh;
    const library = await loadOfferLibrary(scope);
    // Recover pre-redesign hearts that are still in the local swipe history.
    const decisions = await loadOfferDecisionState(scope);
    const legacy = decisions.entries.filter(([id, kind]) => kind === 'i' && !library.likes.some(item => item.id === id));
    if (legacy.length) {
      const [feed, catalogue] = await Promise.all([createApiClient({ accessToken }).getMerchantOffers(), createApiClient({ accessToken }).getVouchers()]);
      for (const [id] of legacy) {
        const offer = feed.offers.find(item => item.id === id);
        const funded = catalogue.fundedOffers.find(item => `funded-${item.allocationId}` === id);
        const saved: SavedOffer = offer ? { id, title: offer.title, merchantName: offer.partner.name, merchantSlug: offer.partner.slug } : funded ? { id, title: funded.title, merchantName: funded.merchant.name, merchantSlug: funded.merchant.slug, allocationId: funded.allocationId } : { id, title: 'Previously liked offer', merchantName: 'Details no longer available', merchantSlug: '' };
        await saveLikedOffer(scope, saved);
      }
      return (await loadOfferLibrary(scope)).likes;
    }
    return library.likes;
  }, [accessToken, scope, refresh]));
  const [removed, setRemoved] = useState<SavedOffer | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function toggle(offer: SavedOffer, save: boolean) {
    if (pending) return; setPending(true); setFailed(false);
    try {
      if (save) await saveLikedOffer(scope, offer); else {
        await removeLikedOffer(scope, offer.id);
        await saveOfferDecisionState(scope, removeOfferDecision(await loadOfferDecisionState(scope), offer.id));
      }
      setData(current => save ? [offer, ...(current ?? []).filter(item => item.id !== offer.id)] : (current ?? []).filter(item => item.id !== offer.id));
      setRemoved(save ? null : offer);
    } catch { setFailed(true); } finally { setPending(false); }
  }
  return <View style={ui.stack}><Text style={ui.heading}>Liked offers</Text><Text style={ui.meta}>Offers you’ve liked on this device.</Text>
    {loading && !data ? <Loading /> : null}{error ? <Notice error title="Couldn't load liked offers" action="Retry" onAction={reload} /> : null}
    {failed ? <Notice error title="Couldn't update your liked offers" body="Please try again." /> : null}
    {removed ? <View style={ui.row}><Text style={[ui.body, ui.flex]}>Offer removed</Text><Action label="Undo" disabled={pending} onPress={() => void toggle(removed, true)} /></View> : null}
    {data?.map(offer => <Card key={offer.id}><View style={ui.row}><View style={ui.flex}><Text style={ui.meta}>{offer.merchantName}</Text><Text style={ui.title}>{offer.title}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${offer.title} from liked offers`} disabled={pending} onPress={() => void toggle(offer, false)} style={ui.action}><MaterialIcon name="heart" size={23} color={palette.teal} /></Pressable></View>{offer.merchantSlug ? <Action label={offer.allocationId ? 'View reward' : 'View offer'} onPress={() => offer.allocationId ? router.push(`/vouchers/funded/${offer.allocationId}`) : router.push(`/merchants/${offer.merchantSlug}`)} /> : <Text style={ui.meta}>This offer is no longer available. You can remove it from your list.</Text>}</Card>)}
    {!loading && !error && data?.length === 0 ? <Notice title="No liked offers yet" body="Tap the heart on an offer to keep it here." action="Explore offers" onAction={() => router.push('/offers')} /> : null}
  </View>;
}
