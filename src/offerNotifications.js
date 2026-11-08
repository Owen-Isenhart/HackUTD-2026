import * as Notifications from 'expo-notifications';
import { offerSummary } from './nearbyOffers';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestOfferNotificationPermission() {
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true },
    });
  }
  return permission.granted;
}

export async function scheduleOfferNotification(offer) {
  if (!await requestOfferNotificationPermission()) return false;
  await Notifications.scheduleNotificationAsync({
    content: { title: `Demo offer at ${offer.merchant}`, body: offerSummary(offer), sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2 },
  });
  return true;
}

export async function scheduleRoutineNotification(offer, isCurrent) {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted || !isCurrent()) return false;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Nearby demo offer',
      body: `Open Hands-Off Banking to see your matched ${offer.cashbackPercent}% demo cashback offer.`,
      sound: 'default',
    },
    trigger: null,
  });
  return true;
}
