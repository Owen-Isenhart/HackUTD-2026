import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { DEMO_LOCATION, SEARCH_RADIUS_METERS, findNearbyOffers, offerSummary } from './src/nearbyOffers';
import { requestOfferNotificationPermission, scheduleOfferNotification, scheduleRoutineNotification } from './src/offerNotifications';
import { DEMO_ROUTINE_TIME, evaluateRoutineVisit, sendRoutineAlertOnce } from './src/routineOffers';

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

function FinanceProfile({ profile, onProfileChange }) {
  const [token, setToken] = useState('');
  const [state, setState] = useState({});

  async function refresh() {
    onProfileChange(null);
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
      onProfileChange(await response.json());
      setState({});
    } catch {
      setState({ error: 'Couldn’t load the finance profile. Check that the demo backend is reachable.' });
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!financeOrigin?.startsWith('https://')) return null;
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
        editable={!state.busy}
        value={token}
        onChangeText={(value) => {
          setToken(value);
          onProfileChange(null);
        }}
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
  const alertedOffers = useRef(new Set());
  const [search, setSearch] = useState({ message: 'Choose a location to see demo offers.' });
  const [profile, setProfile] = useState(null);
  const [alertMode, setAlertMode] = useState(null);
  const [alertStatus, setAlertStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [transcript, setTranscript] = useState('');

  useEffect(() => {
    if (!alertMode || !profile) return;
    const searchId = latestSearch.current;
    const demo = alertMode === 'demo';
    const alerted = demo ? new Set() : alertedOffers.current;
    let active = true;
    let subscription;
    let currentOfferId;
    const isCurrent = () => active && searchId === latestSearch.current;
    const canDeliver = () => isCurrent() && (AppState.currentState === 'active'
      || (demo && AppState.currentState === 'inactive'));

    function stopWithMessage(text, settings = false) {
      if (!isCurrent()) return;
      latestSearch.current += 1;
      setAlertStatus({ text, settings });
      setAlertMode(null);
    }

    async function evaluateFix(fix) {
      if (!canDeliver()) return;
      const visit = evaluateRoutineVisit(profile, fix, demo ? { routineAt: DEMO_ROUTINE_TIME } : undefined);
      currentOfferId = visit?.recommendation?.offer.id;
      if (!visit) {
        setSearch({ message: 'Waiting for a recent, accurate GPS fix…' });
        return;
      }
      const { offers, recommendation, profileExpired } = visit;
      setSearch({
        message: demo ? 'Simulated Friday at noon · Richardson, TX' : `Live location · ±${Math.round(fix.coords.accuracy)} m reported accuracy`,
        offers,
        recommendation,
      });
      if (profileExpired) {
        stopWithMessage('Refresh the finance profile before checking for routine offers again.');
        return;
      }
      if (!recommendation) {
        if (demo) stopWithMessage('No matching Friday midday Chipotle routine in the loaded profile.');
        else setAlertStatus({ text: 'Watching for a nearby offer that matches your routine.' });
        return;
      }
      const { offer } = recommendation;
      if (alerted.has(offer.id)) return;
      const isStillNearby = () => canDeliver() && currentOfferId === offer.id;
      try {
        const sent = await sendRoutineAlertOnce(alerted, offer.id, () => scheduleRoutineNotification(offer, isStillNearby));
        if (!isCurrent()) return;
        if (sent) setAlertStatus({ text: `Local alert scheduled for ${offer.merchant}.` });
        else if (isStillNearby()) stopWithMessage('Allow notifications in Settings to get routine alerts.', true);
      } catch {
        if (isStillNearby()) setAlertStatus({ text: 'Couldn’t schedule the routine alert. Try again.' });
      }
    }

    async function start() {
      if (!demo) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!isCurrent()) return;
        if (!permission.granted) {
          stopWithMessage('Allow location while using the app to get routine alerts.', !permission.canAskAgain);
          return;
        }
      }
      const notificationsAllowed = await requestOfferNotificationPermission();
      if (!isCurrent()) return;
      if (!notificationsAllowed) {
        stopWithMessage('Allow notifications in Settings to get routine alerts.', true);
        return;
      }
      if (demo) {
        await evaluateFix({ coords: { ...DEMO_LOCATION, accuracy: 10 }, timestamp: Date.now() });
        if (isCurrent()) setAlertMode(null);
        return;
      }
      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 15 },
        (fix) => evaluateFix(fix).catch(() => stopWithMessage('Couldn’t check this location against your routines.')),
        () => stopWithMessage('Location updates stopped. Check Location Services and try again.', true),
      );
      if (isCurrent()) subscription = watcher;
      else watcher.remove();
    }

    start().catch(() => stopWithMessage('Couldn’t start routine alerts. Check your permissions and try again.'));
    return () => {
      active = false;
      subscription?.remove();
    };
  }, [alertMode, profile]);

  function updateProfile(nextProfile) {
    latestSearch.current += 1;
    setAlertMode(null);
    setAlertStatus(null);
    setSearch((previous) => ({ ...previous, busy: false, recommendation: null }));
    setProfile(nextProfile);
  }

  function changeAlertMode(mode) {
    latestSearch.current += 1;
    setAlertMode(mode);
    setAlertStatus({ text: mode ? 'Checking permissions and preparing routine alerts…' : 'Routine alerts stopped.' });
    setSearch({ message: mode === 'live' ? 'Waiting for a recent GPS fix…' : 'Choose a location to see demo offers.' });
  }

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
          <Button label={search.busy ? 'Finding your location…' : 'Use my location'} onPress={useMyLocation} disabled={search.busy || Boolean(alertMode)} />
          <Button label="Try demo location" onPress={tryDemoLocation} disabled={Boolean(alertMode)} secondary />
          <Text accessibilityLiveRegion="polite" style={styles.detail}>{search.message}</Text>
          {search.settings && <Button label="Open location settings" onPress={openSettings} secondary />}
        </View>

        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.heading}>Routine alerts</Text>
          <Text style={styles.detail}>
            {profile ? 'Matches offers to your usual day and time while the app is open.' : financeOrigin?.startsWith('https://')
              ? 'Load the sandbox finance profile below to match offers to your purchase history.'
              : 'Set up the HTTPS finance backend to match offers to your purchase history.'}
          </Text>
          <Button
            label={alertMode === 'live' ? 'Stop routine alerts' : 'Start live routine alerts'}
            onPress={() => changeAlertMode(alertMode === 'live' ? null : 'live')}
            disabled={!profile || search.busy || alertMode === 'demo'}
          />
          <Button label="Simulate Friday Chipotle visit" onPress={() => changeAlertMode('demo')} disabled={!profile || search.busy || Boolean(alertMode)} secondary />
          {alertStatus && <Text accessibilityLiveRegion="polite" style={styles.detail}>{alertStatus.text}</Text>}
          {alertStatus?.settings && <Button label="Open settings" onPress={openSettings} secondary />}
          {search.recommendation && (
            <>
              <Text style={styles.offer}>{offerSummary(search.recommendation.offer, search.recommendation.routine.typicalPurchaseCents)}</Text>
              <Text style={styles.detail}>
                {search.recommendation.offer.merchant} · {search.recommendation.routine.weekday} {search.recommendation.routine.daypart} · {search.recommendation.routine.observedDays} days observed
                {search.recommendation.highlighted ? ' · Nemotron highlight' : ''}
              </Text>
            </>
          )}
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

        <FinanceProfile profile={profile} onProfileChange={updateProfile} />
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
