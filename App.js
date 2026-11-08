import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { DEMO_LOCATION, SEARCH_RADIUS_METERS, findNearbyOffers, offerSummary } from './src/nearbyOffers';
import { requestOfferNotificationPermission, scheduleOfferNotification, scheduleRoutineNotification } from './src/offerNotifications';
import { DEMO_ROUTINE_TIME, MAX_FIX_AGE_MS, evaluateRoutineVisit, sendRoutineAlertOnce } from './src/routineOffers';

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
      onProfileChange(await response.json(), token.trim());
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
          <Text style={styles.detail}>{profile.memoryStorage === 'tiger_data' ? 'Routines saved in Tiger Data' : 'Routines loaded for this session'}</Text>
          {profile.refreshStatus === 'cached' && <Text style={styles.detail}>Nessie refresh unavailable. Showing the last saved profile.</Text>}
          <Text style={styles.detail}>Purchases this week · {money(profile.spend.weekToDate.totalCents)}</Text>
          <Text style={styles.detail}>Purchases this month · {money(profile.spend.monthToDate.totalCents)}</Text>
          <Text style={styles.detail}>Last 90 days · {profile.spend.last90Days.count} purchases · {money(profile.spend.last90Days.totalCents)}</Text>
          {profile.confirmedBudget === null && <Text style={styles.detail}>Budget · No confirmed budget</Text>}
          {profile.confirmedBudget && <Text style={styles.detail}>Confirmed budget · {money(profile.confirmedBudget.limitCents)} per {profile.confirmedBudget.period}</Text>}
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
  const [search, setSearch] = useState({});
  const [showDemoTools, setShowDemoTools] = useState(false);
  const [financeSession, setFinanceSession] = useState(null);
  const profile = financeSession?.profile;
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
    let pending;
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
      if (pending && pending.offerId !== currentOfferId) pending.controller.abort();
      if (!visit) {
        setSearch({ message: 'Waiting for a recent, accurate GPS fix…' });
        return;
      }
      const { offers, recommendation: candidate, profileExpired } = visit;
      setSearch((previous) => ({
        message: demo ? 'Simulated Friday at noon · Richardson, TX' : `Live location · ±${Math.round(fix.coords.accuracy)} m reported accuracy`,
        offers,
        recommendation: previous.recommendation?.offer.id === candidate?.offer.id ? previous.recommendation : null,
      }));
      if (profileExpired) {
        stopWithMessage('Refresh the finance profile before checking for routine offers again.');
        return;
      }
      if (!candidate) {
        if (demo) stopWithMessage('No matching Friday midday Chipotle routine in the loaded profile.');
        else setAlertStatus({ text: 'Watching for a nearby offer that matches your routine.' });
        return;
      }
      const { offer } = candidate;
      if (alerted.has(offer.id) || pending?.offerId === offer.id) return;
      const controller = new AbortController();
      const request = { offerId: offer.id, controller };
      pending = request;
      const timer = setTimeout(() => controller.abort(), 12_000);
      const isStillNearby = () => canDeliver() && currentOfferId === offer.id && pending === request;
      try {
        const { latitude, longitude, accuracy } = fix.coords;
        const response = await fetch(`${financeOrigin}/api/finance-recommendation`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${financeSession.token}`, 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(demo ? { source: 'demo' } : { source: 'live', fix: { coords: { latitude, longitude, accuracy }, timestamp: fix.timestamp } }),
        });
        if (!response.ok) throw new Error('Finance recommendation unavailable.');
        const { recommendation, reason } = await response.json();
        if (!isStillNearby()) return;
        if (!recommendation) {
          const explanations = {
            profile_required: 'Refresh the finance profile before checking for routine offers.',
            refresh_required: 'Refresh the finance profile to use current financial data.',
            balance_unavailable: 'Nessie did not provide a usable balance for this offer.',
            insufficient_balance: 'The typical purchase costs more than the last reported balance.',
            budget_limit: 'The typical purchase exceeds your remaining confirmed budget.',
          };
          setAlertStatus({ text: explanations[reason] ?? 'No eligible routine offer for this location and time.' });
          return;
        }
        const canSchedule = () => isStillNearby() && Date.now() < recommendation.expiresAt;
        if (!canSchedule()) return;
        setSearch((previous) => ({ ...previous, recommendation }));
        const sent = await sendRoutineAlertOnce(alerted, offer.id, () => scheduleRoutineNotification(recommendation.offer, canSchedule));
        if (!isCurrent()) return;
        if (sent) setAlertStatus({ text: `Local alert scheduled for ${recommendation.offer.merchant}.` });
        else if (canSchedule()) stopWithMessage('Allow notifications in Settings to get routine alerts.', true);
      } catch {
        if (isStillNearby()) setAlertStatus({ text: 'Couldn’t check the offer or schedule an alert. Try again.' });
      } finally {
        clearTimeout(timer);
        if (pending === request) pending = null;
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
      pending?.controller.abort();
      subscription?.remove();
    };
  }, [alertMode, financeSession, profile]);

  function updateProfile(nextProfile, token) {
    setAlertMode(null);
    setAlertStatus(null);
    setSearch((previous) => ({ ...previous, recommendation: null }));
    setFinanceSession(nextProfile ? { profile: nextProfile, token } : null);
  }

  function changeAlertMode(mode) {
    latestSearch.current += 1;
    setAlertMode(mode);
    setAlertStatus({ text: mode ? 'Checking permissions and preparing routine alerts…' : 'Routine alerts stopped.' });
    setSearch({ message: mode === 'live' ? 'Waiting for a recent GPS fix…' : undefined });
  }

  async function scanForDeals() {
    const searchId = ++latestSearch.current;
    setAlertMode(null);
    setAlertStatus(null);
    setSearch({ busy: true, message: 'Getting your current location…' });
    setFeedback(null);
    setTranscript('');
    Speech.stop().catch(() => {});

    let timeout;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (searchId !== latestSearch.current) return;
      if (!permission.granted) {
        setSearch({ message: 'Allow location while using the app to find offers nearby.', settings: !permission.canAskAgain });
        return;
      }

      const { coords, timestamp } = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Location timed out.')), MAX_FIX_AGE_MS);
        }),
      ]);
      if (searchId !== latestSearch.current) return;
      const age = Date.now() - timestamp;
      if (!Number.isFinite(age) || age < 0 || age > MAX_FIX_AGE_MS) {
        setSearch({ message: 'The location fix was stale. Tap Scan for deals to try again.' });
        return;
      }
      if (!Number.isFinite(coords.accuracy) || coords.accuracy < 0 || coords.accuracy > SEARCH_RADIUS_METERS) {
        setSearch({ message: 'Your location is too approximate for this search. Enable Precise Location or try again outdoors.', settings: true });
        return;
      }

      setSearch({
        message: `Current location · ±${Math.round(coords.accuracy)} m accuracy`,
        offers: findNearbyOffers(coords),
      });
    } catch {
      if (searchId === latestSearch.current) {
        setSearch({ message: 'Couldn’t get a current location. Check Location Services or try again outdoors.' });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  function tryDemoLocation() {
    latestSearch.current += 1;
    setAlertMode(null);
    setAlertStatus(null);
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

  function toggleDemoTools() {
    if (showDemoTools) {
      if (alertMode) {
        latestSearch.current += 1;
        setAlertMode(null);
      }
      setAlertStatus(null);
      setFeedback(null);
      setTranscript('');
      Speech.stop().catch(() => {});
    }
    setShowDemoTools(!showDemoTools);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>HANDS-OFF BANKING · HACKUTD</Text>
        <Text accessibilityRole="header" style={styles.title}>Nearby deals</Text>
        <Text style={styles.detail}>Find demo cashback within {SEARCH_RADIUS_METERS} meters of your current location. The demo catalog covers select Richardson and UT Dallas locations.</Text>

        <View style={styles.card}>
          <Button label={search.busy ? 'Scanning…' : 'Scan for deals'} onPress={scanForDeals} disabled={search.busy} />
          {search.message && <Text accessibilityLiveRegion="polite" style={styles.detail}>{search.message}</Text>}
          {search.settings && <Button label="Open location settings" onPress={openSettings} secondary />}
        </View>

        {search.offers?.length === 0 && (
          <Text accessibilityLiveRegion="polite" style={styles.detail}>No demo deals within {SEARCH_RADIUS_METERS} meters of this location. The sample location is under Demo tools.</Text>
        )}

        {search.offers?.map((offer) => (
          <View key={offer.id} style={styles.card}>
            <Text accessibilityRole="header" style={styles.heading}>{offer.merchant}</Text>
            <Text style={styles.detail}>{offer.address} · ~{Math.round(offer.distance)} m away</Text>
            <Text style={styles.offer}>{offerSummary(offer)}</Text>
            {showDemoTools && (
              <>
                <Button label="Send test notification" onPress={() => sendAlert(offer)} disabled={sending} secondary />
                <Button label="Play demo call" onPress={() => playDemoCall(offer)} secondary />
              </>
            )}
          </View>
        ))}

        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDemoTools }} onPress={toggleDemoTools} style={styles.toolsToggle}>
          <Text style={styles.toolsText}>{showDemoTools ? 'Hide demo tools' : 'Demo tools'}</Text>
        </Pressable>

        {showDemoTools && (
          <>
            <Button label="Try demo location" onPress={tryDemoLocation} secondary />
            <FinanceProfile profile={profile} onProfileChange={updateProfile} />
            <View style={styles.card}>
              <Text accessibilityRole="header" style={styles.heading}>Routine alerts</Text>
              <Text style={styles.detail}>
                {profile ? 'Checks nearby matches with the finance backend while the app is open. Location fixes used for a check are discarded afterward.' : financeOrigin?.startsWith('https://')
                  ? 'Load the sandbox finance profile to match offers to your purchase history.'
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
                  <Text style={styles.offer}>{search.recommendation.explanation.text}</Text>
                  <Text style={styles.detail}>
                    {search.recommendation.offer.merchant} · {search.recommendation.routine.weekday} {search.recommendation.routine.daypart} · {search.recommendation.routine.observedDays} days observed
                    {search.recommendation.explanation.status === 'interpreted' ? ' · Nemotron explanation' : ''}
                  </Text>
                </>
              )}
            </View>

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
          </>
        )}
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
  toolsToggle: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  toolsText: { color: '#9DCEBF', fontSize: 15 },
});
