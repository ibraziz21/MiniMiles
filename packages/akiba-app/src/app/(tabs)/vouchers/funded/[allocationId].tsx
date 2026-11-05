import { Stack, router, useLocalSearchParams } from 'expo-router';

import { FundedOfferClaim } from '@/components/funded-offer-claim';

export default function FundedOfferClaimScreen() {
  const { allocationId, title, merchantName, benefit, minimumSpendKes } = useLocalSearchParams<{
    allocationId: string;
    title?: string;
    merchantName?: string;
    benefit?: string;
    minimumSpendKes?: string;
  }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Claim offer' }} />
      <FundedOfferClaim
        allocationId={allocationId}
        title={title}
        merchantName={merchantName}
        benefit={benefit}
        minimumSpendKes={minimumSpendKes}
        onViewClaimed={() => router.replace('/vouchers')}
        onViewVoucher={(id) => router.replace(`/vouchers/${id}`)}
      />
    </>
  );
}
