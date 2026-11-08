import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ImageBackground,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Jost_300Light, useFonts } from '@expo-google-fonts/jost';
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

const NESSIE_ASPECT = 499 / 622; // width / height of assets/nessie.png
const useNativeDriver = Platform.OS !== 'web';

// Sizes for the half-submerged Nessie. Only the top `cutFrac` of the picture is shown, as if
// the rest were under the water. `headroom` is spare space above his head so that the stretch
// part of the wobble is not clipped by the box.
function nessieBox(width) {
  const height = width / NESSIE_ASPECT;
  const cutFrac = 0.78;
  const headroom = height * 0.16;
  return { height, cutFrac, headroom, boxHeight: headroom + height * cutFrac };
}

// Nessie wobbles like jelly, pivoting at the waterline: a slow, gentle idle sway, and a soft
// squash-and-spring when tapped. `squish` runs from -1 (squashed) to +1 (stretched tall); the
// width moves the opposite way so the body keeps its volume.
function JellyNessie({ width }) {
  const squish = useRef(new Animated.Value(0)).current;
  const idle = useRef(null);
  const { height, cutFrac, headroom, boxHeight } = nessieBox(width);

  function startIdle() {
    idle.current = Animated.loop(
      Animated.sequence([
        Animated.timing(squish, { toValue: 0.2, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver }),
        Animated.timing(squish, { toValue: -0.1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver }),
      ]),
    );
    idle.current.start();
  }

  useEffect(() => {
    startIdle();
    return () => {
      idle.current?.stop();
      squish.stopAnimation();
    };
  }, []);

  function poke() {
    idle.current?.stop();
    squish.stopAnimation(); // start from wherever he is now, so a second tap does not jump
    Animated.sequence([
      Animated.timing(squish, { toValue: -0.8, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver }),
      Animated.spring(squish, { toValue: 0, friction: 5, tension: 55, useNativeDriver }),
    ]).start(({ finished }) => finished && startIdle());
  }

  const scaleY = squish.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.9, 1, 1.06] });
  const scaleX = squish.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.08, 1, 0.96] });

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Poke Nessie" onPress={poke}>
      {/* Rounded bottom corners make the cut curve down in the middle, like a waterline wrapping round a body. */}
      <View
        style={{
          width,
          height: boxHeight,
          overflow: 'hidden',
          borderBottomLeftRadius: width * 0.18,
          borderBottomRightRadius: width * 0.18,
        }}
      >
        <Animated.Image
          source={require('./assets/nessie.png')}
          resizeMode="contain"
          style={{
            position: 'absolute',
            top: headroom,
            left: 0,
            width,
            height,
            transformOrigin: `50% ${cutFrac * 100}%`,
            transform: [{ scaleX }, { scaleY }],
          }}
        />
      </View>
    </Pressable>
  );
}

// One ripple ring: spreads steadily outward from where Nessie goes under the water, fading as it goes.
// `delay` (in milliseconds) lets a second ring start half a cycle after the first.
function Ring({ width, delay }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver }));
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        {
          width,
          height: width * 0.2,
          top: -width * 0.1,
          borderRadius: '50%', // a percentage radius gives a true ellipse; a plain number gives a pill
          opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }),
          transform: [{ scaleX: t.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.4] }) }],
        },
      ]}
    />
  );
}

function Ripples({ width }) {
  return (
    <>
      <Ring width={width} delay={0} />
      <Ring width={width} delay={2000} />
    </>
  );
}

function HomeHero({ height }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const nessieWidth = Math.min(width * 0.62, 300);
  const waterline = height * 0.5; // the water begins about halfway down the lake picture

  // There is no account server in this project yet, so Sign in and Sign up only check what was
  // typed (Sign in) and then say they are not connected. Replace these two when a backend exists.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');

  function signIn() {
    setNotice(!username.trim() || !password
      ? 'Enter a username and password.'
      : 'Sign-in isn’t connected to a server yet.');
  }

  function signUp() {
    setNotice('Sign-up isn’t connected to a server yet.');
  }

  return (
    <ImageBackground source={require('./assets/lake.webp')} resizeMode="cover" style={{ width, height }}>
      <View style={[styles.logoRow, { paddingTop: insets.top + 14 }]}>
        <Text accessibilityRole="header" style={styles.logo}>Nessential</Text>
        <Pressable accessibilityRole="button" onPress={signUp} style={styles.signUpPill}>
          <Text style={styles.signUpPillText}>Sign up</Text>
        </Pressable>
      </View>

      {/* The bottom edge of this box is the waterline Nessie goes under. */}
      <View style={[styles.mascot, { top: waterline + (height - waterline) * 0.3 - nessieBox(nessieWidth).boxHeight }]}>
        {/* Drawn before Nessie, so the far half of each ring passes behind his body instead of across it. */}
        <View pointerEvents="none" style={styles.rippleBox}>
          <Ripples width={nessieWidth * 0.95} />
        </View>
        <JellyNessie width={nessieWidth} />
      </View>

      <View style={[styles.heroFooter, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.signIn}>
          <TextInput
            accessibilityLabel="Username"
            placeholder="Username"
            placeholderTextColor="#6B7F86"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            value={username}
            onChangeText={setUsername}
            style={styles.authInput}
          />
          <TextInput
            accessibilityLabel="Password"
            placeholder="Password"
            placeholderTextColor="#6B7F86"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={signIn}
            style={styles.authInput}
          />
          <Pressable accessibilityRole="button" onPress={signIn} style={styles.signInButton}>
            <Text style={styles.signInButtonText}>Sign in</Text>
          </Pressable>
          {notice !== '' && <Text accessibilityLiveRegion="polite" style={styles.authNotice}>{notice}</Text>}
        </View>
      </View>
    </ImageBackground>
  );
}

function NearbyOffers() {
  const { height: windowHeight } = useWindowDimensions();
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
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.scrollContent} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        <HomeHero height={windowHeight} />
        <View style={styles.content}>
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
        </View>
      </ScrollView>
    </View>
  );
}

export default function App() {
  // Jost is a free font that looks like Futura, the thin geometric lettering in the logo image.
  const [fontsLoaded] = useFonts({ Jost_300Light });
  if (!fontsLoaded) return null;
  return <SafeAreaProvider><NearbyOffers /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A1720' },
  scrollContent: { flexGrow: 1 },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  logoRow: { paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  signUpPill: {
    borderColor: 'rgba(246, 244, 239, 0.55)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: 'rgba(10, 23, 32, 0.5)',
  },
  signUpPillText: { color: '#F6F4EF', fontSize: 14, fontWeight: '600' },
  // No card behind the sign-in fields: white fields sit straight on the lake.
  signIn: { width: '90%', maxWidth: 380, gap: 10 },
  authInput: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: '#12303A',
    fontSize: 16,
    backgroundColor: '#FFFFFF',
  },
  // Same near-black as the logo text.
  signInButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 10, backgroundColor: '#050505' },
  signInButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  authNotice: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    textShadowColor: 'rgba(8, 24, 36, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Matches the "Nessential" lettering in the logo image: thin geometric sans, near-black (#050505).
  logo: { color: '#050505', fontFamily: 'Jost_300Light', fontSize: 44, letterSpacing: 1.5 },
  mascot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  rippleBox: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0, alignItems: 'center' },
  ripple: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(240, 248, 248, 0.85)' },
  heroFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
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
