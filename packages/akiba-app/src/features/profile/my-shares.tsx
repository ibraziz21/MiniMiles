import { useCallback, useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { useFeatureFlags } from '@/config';
import { Icon } from '@/design-system';
import type { ProfileShare } from '@/contracts/profile-library';
import { PlaceShareSheet, publicPlaceLink, type PlaceShareContent } from '@/components/place-share-sheet';
import { VerifiedVisitPhotoSheet } from '@/components/verified-visit-photo-sheet';
import { useContributionSaved } from '@/features/recommend/saved-events';
import { Action, Card, Loading, Notice, palette, ui } from './ui';
import { useProfileResource } from './use-profile-resource';

export function MyShares({ refresh }: { refresh: number }) {
  const { accessToken } = useAuth();
  const { discoveryContributions } = useFeatureFlags();
  const { data, setData, loading, error, reload } = useProfileResource(useCallback(() => {
    void refresh; return createApiClient({ accessToken }).getProfileShares();
  }, [accessToken, refresh]));
  const [photos, setPhotos] = useState<ProfileShare | null>(null);
  const [shareContent, setShareContent] = useState<PlaceShareContent | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  // The app's own recommendation form; this list refreshes when it saves.
  const openPhotosFor = useRef<string | null>(null);
  function edit(requestId: string, existing: boolean) {
    router.push({ pathname: '/merchants/visit/[requestId]', params: existing ? { requestId, edit: '1' } : { requestId } });
  }
  useContributionSaved((event) => {
    if (event.openPhotos) openPhotosFor.current = event.requestId;
    void reload();
  });
  useEffect(() => {
    const requestId = openPhotosFor.current;
    const share = requestId ? data?.shares.find((item) => item.requestId === requestId) : undefined;
    if (share) {
      openPhotosFor.current = null;
      setPhotos(share);
    }
  }, [data]);
  async function more() {
    if (data?.nextOffset == null || moreLoading) return; setMoreLoading(true); setMoreError(false);
    try {
      const next = await createApiClient({ accessToken }).getProfileShares(data.nextOffset);
      setData(current => current ? { ...next, shares: [...current.shares, ...next.shares.filter(item => !current.shares.some(old => old.id === item.id))] } : next);
    } catch { setMoreError(true); } finally { setMoreLoading(false); }
  }
  function options(share: ProfileShare) {
    Alert.alert(share.merchantName, 'Your community share', [
      ...(discoveryContributions ? [{ text: 'Add photos', onPress: () => setPhotos(share) }] : []),
      ...(share.publiclyVisible && share.merchantSlug ? [{ text: 'Share experience', onPress: () => setShareContent({ title: 'Share your experience', name: share.merchantName, logoUrl: share.merchantLogoUrl, url: publicPlaceLink(share.merchantSlug, share.id), visit: true }) }] : []),
      ...(share.merchantSlug ? [{ text: 'View at merchant', onPress: () => router.push(`/merchants/${share.merchantSlug}`) }] : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  async function removePhoto(share: ProfileShare, photoId: string) {
    if (removing) return; setRemoving(photoId);
    try { await createApiClient({ accessToken }).withdrawVerifiedVisitPhoto(share.id, photoId); await reload(); }
    catch { Alert.alert('Photo not removed', 'Please try again. Your community share is still saved.'); }
    finally { setRemoving(null); }
  }
  return <View style={ui.stack}>
    {loading && !data ? <Loading /> : null}
    {error ? <Notice error title="Couldn't load your shares" action="Retry" onAction={reload} /> : null}
    {discoveryContributions ? data?.opportunities.map(opportunity => <Card key={opportunity.id}><View style={ui.row}><View style={ui.icon}><Icon name="message-square" size={23} color={palette.teal} /></View><View style={ui.flex}><Text style={ui.title}>Share your experience at {opportunity.merchantName}</Text><Text style={ui.meta}>Unlocked by a qualifying visit</Text></View></View><Action primary label="Share your experience" onPress={() => edit(opportunity.id, false)} /></Card>) : null}
    {data?.shares.length ? <Text style={ui.heading}>Your shares</Text> : null}
    {data?.shares.map(share => <Card key={share.id}>
      <View style={ui.row}><View style={ui.icon}>{share.merchantLogoUrl ? <Image source={share.merchantLogoUrl} style={{ width: 36, height: 36 }} contentFit="contain" /> : <Icon name="coffee" size={22} color={palette.teal} />}</View><View style={ui.flex}><Text style={ui.title}>{share.merchantName}</Text><Text style={ui.meta}>{new Date(share.submittedAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Options for your share at ${share.merchantName}`} style={ui.action} onPress={() => options(share)}><Icon name="more-vertical" size={20} color={palette.muted} /></Pressable></View>
      {share.items.length ? <Text style={ui.body}>Tried: {share.items.join(', ')}</Text> : null}
      {share.experienceLabels.length ? <Text style={ui.body}>{share.experienceLabels.join(' · ')}</Text> : null}
      <Text style={ui.meta}>{share.recommendation === 'recommended' ? 'You would recommend this place' : share.recommendation === 'not_recommended' ? 'You would not recommend this place' : 'Visit shared'}</Text>
      {share.photos.length ? <View style={[ui.row, { flexWrap: 'wrap' }]}>{share.photos.map(photo => <View key={photo.id} style={{ gap: 4 }}>
        {photo.url ? <Image source={photo.url} accessibilityLabel={`Your photo at ${share.merchantName}`} style={{ width: 76, height: 76, borderRadius: 10 }} contentFit="cover" /> : null}
        {discoveryContributions ? <Action label={removing === photo.id ? 'Removing…' : 'Remove photo'} disabled={!!removing} onPress={() => Alert.alert('Remove this photo?', 'Your community share will stay saved.', [{ text: 'Keep photo', style: 'cancel' }, { text: 'Remove photo', style: 'destructive', onPress: () => void removePhoto(share, photo.id) }])} /> : null}
        <Text style={ui.meta}>{photo.status === 'approved' ? 'Photo approved' : photo.status === 'rejected' ? 'Photo not approved' : 'Photo under review'}</Text>
      </View>)}</View> : null}
      {discoveryContributions ? <Action label="Edit share" icon="edit-2" onPress={() => edit(share.requestId, true)} /> : null}
    </Card>)}
    {!loading && !error && data?.shares.length === 0 ? <Notice title="No community shares yet" body="After a qualifying in-store visit, share what you tried and help others decide where to go." action={!data.opportunities.length ? 'Explore places' : undefined} onAction={() => router.push('/merchants')} /> : null}
    {moreError ? <Notice error title="Couldn't load more shares" action="Retry" onAction={more} /> : data?.nextOffset != null ? <Action label={moreLoading ? 'Loading…' : 'Load more'} disabled={moreLoading} onPress={more} /> : null}
    {shareContent ? <PlaceShareSheet content={shareContent} onClose={() => setShareContent(null)} /> : null}
    {photos && accessToken ? <VerifiedVisitPhotoSheet key={photos.id} accessToken={accessToken} merchantName={photos.merchantName} visit={photos} visible onClose={() => { setPhotos(null); void reload(); }} onUpdated={reload} /> : null}
  </View>;
}
