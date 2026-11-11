import { useCallback, useState } from 'react';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { createApiClient } from '@/api';
import { useAuth } from '@/auth';
import type { MobileOverview } from '@/contracts';
import { Icon } from '@/design-system';
import { Action, Card, Loading, Notice, Pills, palette, ui } from './ui';
import { useProfileResource } from './use-profile-resource';

export function MyRewards({ balance, refresh }: { balance: MobileOverview['balance']; refresh: number }) {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<'active' | 'redeemed' | 'expired'>('active');
  return <View style={ui.stack}>
    <Card><View style={ui.row}><View style={ui.flex}><Text style={ui.meta}>Available balance</Text><Text style={ui.heading}>{balance.hasBalance ? balance.balance.toLocaleString('en-KE') : '—'} Miles</Text></View><Action label="View activity" icon="arrow-right" onPress={() => router.push('/profile/activity')} /></View></Card>
    <Pills value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'redeemed', label: 'Used' }, { value: 'expired', label: 'Expired' }]} />
    <VoucherList key={status} status={status} accessToken={accessToken} refresh={refresh} />
  </View>;
}
function VoucherList({ status, accessToken, refresh }: { status: 'active' | 'redeemed' | 'expired'; accessToken: string | null; refresh: number }) {
  const { data, setData, loading, error, reload } = useProfileResource(useCallback(() => {
    void refresh;
    return createApiClient({ accessToken }).getOwnedVouchers({ status, limit: 20 });
  }, [accessToken, status, refresh]));
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState(false);
  async function more() {
    if (!data?.next_cursor || moreLoading) return;
    setMoreLoading(true); setMoreError(false);
    try {
      const next = await createApiClient({ accessToken }).getOwnedVouchers({ status, limit: 20, cursor: data.next_cursor });
      setData(current => current ? { vouchers: [...current.vouchers, ...next.vouchers.filter(v => !current.vouchers.some(old => old.id === v.id))], next_cursor: next.next_cursor } : next);
    } catch { setMoreError(true); } finally { setMoreLoading(false); }
  }
  return <View style={ui.stack}>
    {loading && !data ? <Loading /> : null}
    {error ? <Notice error title="Couldn't load your vouchers" action="Retry" onAction={reload} /> : null}
    {data?.vouchers.map(voucher => <Card key={voucher.id}>
      <View style={ui.row}><View style={ui.icon}>{voucher.merchantLogoUrl ? <Image source={voucher.merchantLogoUrl} style={{ width: 38, height: 38 }} contentFit="contain" /> : <Icon name="gift" size={22} color={palette.teal} />}</View><View style={ui.flex}><Text style={ui.meta}>{voucher.merchantName ?? voucher.programName ?? 'Akiba reward'}</Text><Text style={ui.title}>{voucher.title}</Text></View></View>
      <View style={[ui.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}><Text style={ui.badge}>{voucher.status === 'pending' || voucher.status === 'claiming' ? 'Preparing voucher' : status === 'redeemed' ? 'Used' : status === 'expired' ? 'Expired' : voucher.expiresAt ? `Valid until ${new Date(voucher.expiresAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}` : 'Ready to use'}</Text><Action label={voucher.status === 'pending' || voucher.status === 'claiming' ? 'Check status' : 'View voucher'} icon="arrow-right" onPress={() => router.push(`/vouchers/${voucher.id}`)} /></View>
    </Card>)}
    {!loading && !error && data?.vouchers.length === 0 ? <Notice title={status === 'active' ? 'No active vouchers yet' : status === 'redeemed' ? 'No used vouchers yet' : 'No expired vouchers'} body={status === 'active' ? 'Find a reward you like. Claimed vouchers will appear here.' : 'Your vouchers will appear here when their status changes.'} action={status === 'active' ? 'Explore rewards' : undefined} onAction={() => router.push('/vouchers')} /> : null}
    {moreError ? <Notice error title="Couldn't load more vouchers" action="Retry" onAction={more} /> : data?.next_cursor ? <Action label={moreLoading ? 'Loading…' : 'Load more'} disabled={moreLoading} onPress={more} /> : null}
  </View>;
}
