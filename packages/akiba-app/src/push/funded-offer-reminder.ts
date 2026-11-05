import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { FundedOffer } from '@/contracts';

export function fundedOfferReminderId(allocationId: string) {
  return `funded-offer-${allocationId}`;
}

export async function scheduleFundedOfferReminder(offer: FundedOffer) {
  const date = new Date(offer.nextOpeningAt ?? '');
  if (!(date.getTime() > Date.now())) {
    throw new Error('This opening has passed. Refresh the offers to check the next date.');
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
    throw new Error('This opening has passed. Refresh the offers to check the next date.');
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
