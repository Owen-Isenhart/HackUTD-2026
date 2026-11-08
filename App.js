import React, { useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { DEMO_LOCATION, SEARCH_RADIUS_METERS, findNearbyOffers, offerSummary } from './src/nearbyOffers';
import { scheduleOfferNotification } from './src/offerNotifications';

const financeOrigin = process.env.EXPO_PUBLIC_FINANCE_API_URL?.replace(/\/+$/, '');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function money(cents) {
  return cents === null ? 'Unavailable' : usd.format(cents / 100);
}

function Button({ label, onPress, secondary = false, disabled = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.secondary, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function FinanceProfile() {
  const [token, setToken] = useState('');
  const [state, setState] = useState({});

  async function refresh() {
    setState({ busy: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`${financeOrigin}/api/finance-profile`, {
        headers: { Authorization: `Bearer ${token.trim()}` },
        signal: controller.signal,
      });
      if (response.status === 401) {
        setState({ error: 'Check the finance demo token and try again.' });
        return;
      }
      if (!response.ok) throw new Error();
      setState({ profile: await response.json() });
    } catch {
      setState({ error: 'Couldn’t load the finance profile. Check that the demo backend is reachable.' });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!financeOrigin?.startsWith('https://')) return null;
  const { profile } = state;
  const insight = profile?.routineInsight;
  const highlighted = profile?.routines[insight?.routineIndex];
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>Sandbox finance profile</Text>
      <TextInput
        accessibilityLabel="Finance demo token"
        placeholder="Finance demo token"
        placeholderTextColor="#B6CBD0"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={token}
        onChangeText={setToken}
        style={styles.input}
      />
      <Button label={state.busy ? 'Refreshing…' : 'Refresh finance profile'} onPress={refresh} disabled={state.busy || !token.trim()} />
      {state.error && <Text accessibilityLiveRegion="polite" style={styles.detail}>{state.error}</Text>}
      {profile && (
        <>
          <Text style={styles.offer}>Nessie balance · {money(profile.balanceCents)}</Text>
          <Text style={styles.detail}>Purchases this week · {money(profile.spend.weekToDate.totalCents)}</Text>
          <Text style={styles.detail}>Purchases this month · {money(profile.spend.monthToDate.totalCents)}</Text>
          <Text style={styles.detail}>Last 90 days · {profile.spend.last90Days.count} purchases · {money(profile.spend.last90Days.totalCents)}</Text>
          {profile.confirmedBudget === null && <Text style={styles.detail}>Budget · No confirmed budget</Text>}
          {highlighted && (
            <Text style={styles.offer}>
              {insight.status === 'interpreted' ? 'Nemotron highlight' : 'Top observed routine'} · {highlighted.merchant} · {highlighted.weekday}{highlighted.daypart ? ` ${highlighted.daypart}` : ''}
            </Text>
          )}
          {insight.status === 'unavailable' && <Text style={styles.detail}>Nemotron is unavailable. Showing the observed routines from Nessie.</Text>}
          {insight.status === 'no_routine' && <Text style={styles.detail}>No repeat purchase patterns in this history.</Text>}
          {profile.routines.map((routine) => (
            <Text key={JSON.stringify([routine.provenance.merchantSourceId, routine.weekday, routine.daypart])} style={styles.detail}>
              {routine.merchant} · {routine.weekday}{routine.daypart ? ` ${routine.daypart}` : ''} · {routine.observedDays} days observed · {money(routine.typicalPurchaseCents)} typical
              {routine.confidence === 'tentative' ? ' · tentative' : ''}
            </Text>
          ))}
        </>
      )}
    </View>
  );
}

function NearbyOffers() {
  const latestSearch = useRef(0);
  const [search, setSearch] = useState({ message: 'Choose a location to see demo offers.' });
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [transcript, setTranscript] = useState('');

  async function useMyLocation() {
    const searchId = ++latestSearch.current;
    setSearch({ busy: true, message: 'Getting your iPhone location…' });
    setFeedback(null);
    setTranscript('');
    Speech.stop().catch(() => {});

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (searchId !== latestSearch.current) return;
      if (!permission.granted) {
        setSearch({ message: 'Allow location while using the app to find offers nearby.', settings: !permission.canAskAgain });
        return;
      }

      const cached = await Location.getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 75 });
      if (searchId !== latestSearch.current) return;
      const { coords } = cached ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (searchId !== latestSearch.current) return;
      if (!Number.isFinite(coords.accuracy) || coords.accuracy < 0 || coords.accuracy > SEARCH_RADIUS_METERS) {
        setSearch({ message: 'Your location is too approximate for this search. Enable Precise Location or try again outdoors.', settings: true });
        return;
      }

      setSearch({
        message: `Your location · ±${Math.round(coords.accuracy)} m reported accuracy`,
        offers: findNearbyOffers(coords),
      });
    } catch {
      if (searchId === latestSearch.current) {
        setSearch({ message: 'Couldn’t get your location. Check that Location Services is on, then retry or try the demo location.' });
      }
    }
  }

  function tryDemoLocation() {
    latestSearch.current += 1;
    setSearch({ message: 'Sample location · Richardson, TX', offers: findNearbyOffers(DEMO_LOCATION) });
    setFeedback(null);
    setTranscript('');
    Speech.stop().catch(() => {});
  }

  async function sendAlert(offer) {
    setSending(true);
    try {
      const scheduled = await scheduleOfferNotification(offer);
      setFeedback(scheduled
        ? { text: 'Notification scheduled. Look for the iPhone banner.' }
        : { text: 'Allow notifications in Settings to see the offer banner.', settings: true });
    } catch {
      setFeedback({ text: 'Couldn’t schedule the notification. Try again.' });
    } finally {
      setSending(false);
    }
  }

  async function playDemoCall(offer) {
    const message = `Hi, this is Hands-Off Banking. There’s a nearby offer at ${offer.merchant}. ${offerSummary(offer)}`;
    setTranscript(message);
    const showAudioError = () => setFeedback({ text: 'Couldn’t play call audio. Try again.' });
    try {
      await Speech.stop();
      Speech.speak(message, { language: 'en-US', onError: showAudioError });
    } catch {
      showAudioError();
    }
  }

  const openSettings = () => Linking.openSettings().catch(() => {});

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>HANDS-OFF BANKING · HACKUTD</Text>
        <Text accessibilityRole="header" style={styles.title}>Nearby offers</Text>
        <Text style={styles.detail}>See example cashback offers within {SEARCH_RADIUS_METERS} meters. The rates are fictional.</Text>

        <View style={styles.card}>
          <Button label={search.busy ? 'Finding your location…' : 'Use my location'} onPress={useMyLocation} disabled={search.busy} />
          <Button label="Try demo location" onPress={tryDemoLocation} secondary />
          <Text accessibilityLiveRegion="polite" style={styles.detail}>{search.message}</Text>
          {search.settings && <Button label="Open location settings" onPress={openSettings} secondary />}
        </View>

        {search.offers?.length === 0 && (
          <Text style={styles.detail}>No offers in the demo catalog are within {SEARCH_RADIUS_METERS} meters. Try the demo location to see an example.</Text>
        )}

        {search.offers?.map((offer) => (
          <View key={offer.id} style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>{offer.merchant}</Text>
            <Text style={styles.detail}>{offer.address} · ~{Math.round(offer.distance)} m away</Text>
            <Text style={styles.offer}>{offerSummary(offer)}</Text>
            <Button label="Send test notification" onPress={() => sendAlert(offer)} disabled={sending} secondary />
            <Button label="Play demo call" onPress={() => playDemoCall(offer)} secondary />
          </View>
        ))}

        {feedback && (
          <View style={styles.card}>
            <Text accessibilityLiveRegion="polite" style={styles.detail}>{feedback.text}</Text>
            {feedback.settings && <Button label="Open notification settings" onPress={openSettings} secondary />}
          </View>
        )}

        {transcript !== '' && (
          <View style={styles.card}>
            <Text style={styles.heading}>Demo call transcript</Text>
            <Text style={styles.detail}>{transcript}</Text>
            <Text style={styles.detail}>Turn off Silent Mode to hear the voice.</Text>
            <Button label="Stop audio" onPress={() => Speech.stop().catch(() => {})} secondary />
          </View>
        )}

        <FinanceProfile />
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><NearbyOffers /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A1720' },
  content: { padding: 20, gap: 14 },
  eyebrow: { color: '#9DCEBF', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  title: { color: '#F2F9F7', fontSize: 34, fontWeight: '700' },
  heading: { color: '#F2F9F7', fontSize: 21, fontWeight: '700' },
  detail: { color: '#B6CBD0', fontSize: 15, lineHeight: 22 },
  input: { borderColor: '#52717B', borderWidth: 1, borderRadius: 8, color: '#F2F9F7', padding: 10, minHeight: 44 },
  offer: { color: '#95F2CD', fontSize: 17, fontWeight: '700', lineHeight: 23 },
  card: { backgroundColor: '#142833', borderRadius: 12, padding: 14, gap: 10 },
  button: { alignItems: 'center', backgroundColor: '#286652', borderRadius: 8, minHeight: 44, justifyContent: 'center', padding: 10 },
  secondary: { backgroundColor: '#214552' },
  disabled: { opacity: 0.55 },
  buttonText: { color: '#F2F9F7', fontSize: 16, fontWeight: '600' },
});
