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

export async function scheduleOfferNotification(offer) {
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true },
    });
  }
  if (!permission.granted) return false;

  await Notifications.scheduleNotificationAsync({
    content: { title: `Demo offer at ${offer.merchant}`, body: offerSummary(offer), sound: 'default' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2 },
  });
  return true;
}
