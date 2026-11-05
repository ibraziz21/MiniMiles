import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { FundedOffer } from '@/contracts';

export function fundedOfferReminderId(allocationId: string) {
  return `funded-offer-${allocationId}`;
}

export async function scheduleFundedOfferReminder(offer: FundedOffer, leadMinutes = 0) {
  const date = new Date(Date.parse(offer.nextOpeningAt ?? '') - leadMinutes * 60_000);
  if (!(date.getTime() > Date.now())) {
    throw new Error('That reminder time has passed. Choose a shorter reminder or check the next opening.');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('offer-reminders', {
      name: 'Offer reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    throw new Error('Allow Akiba notifications in your phone settings to set a reminder.');
  }
  if (date.getTime() <= Date.now()) {
    throw new Error('That reminder time has passed. Choose a shorter reminder or check the next opening.');
  }

  await Notifications.scheduleNotificationAsync({
    identifier: fundedOfferReminderId(offer.allocationId),
    content: {
      title: 'Offer reminder',
      body: `Check the latest availability for ${offer.title}.`,
      data: { url: `/merchants/${offer.merchant.slug}`, openingAt: offer.nextOpeningAt },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      ...(Platform.OS === 'android' ? { channelId: 'offer-reminders' } : {}),
    },
  });
}
