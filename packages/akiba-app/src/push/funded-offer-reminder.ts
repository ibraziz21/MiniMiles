import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { FundedOffer } from '@/contracts';

export function fundedOfferReminderId(allocationId: string) {
  return `funded-offer-${allocationId}`;
}

export async function scheduleFundedOfferReminder(offer: FundedOffer, leadMinutes = 0, ownerId?: string) {
  const date = new Date(Date.parse(offer.nextOpeningAt ?? '') - leadMinutes * 60_000);
  return scheduleOfferReminder({
    id: fundedOfferReminderId(offer.allocationId),
    title: offer.title,
    merchantSlug: offer.merchant.slug,
    date,
    ownerId,
    openingAt: offer.nextOpeningAt ?? undefined,
  });
}

export async function scheduleOfferReminder(offer: { id: string; title: string; merchantSlug: string; date: Date; ownerId?: string; openingAt?: string }) {
  const { date } = offer;
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
    identifier: offer.id,
    content: {
      title: 'Offer reminder',
      body: `Check the latest availability for ${offer.title}.`,
      data: { url: `/merchants/${offer.merchantSlug}`, ...(offer.ownerId ? { ownerId: offer.ownerId, offerTitle: offer.title, remindAt: date.toISOString() } : {}), ...(offer.openingAt ? { openingAt: offer.openingAt } : {}) },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      ...(Platform.OS === 'android' ? { channelId: 'offer-reminders' } : {}),
    },
  });
}

/** A different member using this phone must not inherit local offer alerts. */
export async function cancelMemberOfferReminders(ownerId: string) {
  if (Platform.OS === 'web') return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter(request => request.content.data?.ownerId === ownerId)
    .map(request => Notifications.cancelScheduledNotificationAsync(request.identifier)));
}
