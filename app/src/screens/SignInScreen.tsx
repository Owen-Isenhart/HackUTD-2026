import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ImageBackground,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '../motion';

// Ported from nessie-signin-prototype/App.js (HomeHero). Same look and behavior; typed, with
// ambient loops (idle sway, ripples) switched off under reduced motion.
const NESSIE_ASPECT = 499 / 622; // width / height of assets/signin/nessie.png
const useNativeDriver = Platform.OS !== 'web';

function nessieBox(width: number) {
  const height = width / NESSIE_ASPECT;
  const cutFrac = 0.78;
  const headroom = height * 0.16;
  return { height, cutFrac, headroom, boxHeight: headroom + height * cutFrac };
}

// Nessie wobbles like jelly, pivoting at the waterline: slow idle sway, soft squash-and-spring on tap.
function JellyNessie({ width, reduce }: { width: number; reduce: boolean }) {
  const squish = useRef(new Animated.Value(0)).current;
  const idle = useRef<Animated.CompositeAnimation | null>(null);
  const { height, cutFrac, headroom, boxHeight } = nessieBox(width);

  function startIdle() {
    if (reduce) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  function poke() {
    if (reduce) return;
    idle.current?.stop();
    squish.stopAnimation();
    Animated.sequence([
      Animated.timing(squish, { toValue: -0.8, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver }),
      Animated.spring(squish, { toValue: 0, friction: 5, tension: 55, useNativeDriver }),
    ]).start(({ finished }) => finished && startIdle());
  }

  const scaleY = squish.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.9, 1, 1.06] });
  const scaleX = squish.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.08, 1, 0.96] });

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Poke Nessie" onPress={poke}>
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
          source={require('../../assets/signin/nessie.png')}
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

function Ring({ width, delay, reduce }: { width: number; delay: number; reduce: boolean }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 4000, easing: Easing.linear, useNativeDriver }));
    const timer = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [reduce, delay, t]);
  if (reduce) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        {
          width,
          height: width * 0.2,
          top: -width * 0.1,
          borderRadius: '50%',
          opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }),
          transform: [{ scaleX: t.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.4] }) }],
        },
      ]}
    />
  );
}

export default function SignInScreen({ onContinue }: { onContinue: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const nessieWidth = Math.min(width * 0.62, 300);
  const waterline = height * 0.5;

  // There is no account server yet. Sign in / Sign up only validate input and say they are not
  // connected (same as the prototype). "Continue in demo mode" is the only way into the app and
  // does NOT authenticate. Replace signIn/signUp when the authed server layer exists.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');

  function signIn() {
    setNotice(!username.trim() || !password ? 'Enter a username and password.' : 'Sign-in isn’t connected to a server yet.');
  }
  function signUp() {
    setNotice('Sign-up isn’t connected to a server yet.');
  }

  return (
    <ImageBackground source={require('../../assets/signin/lake.webp')} resizeMode="cover" style={{ width, height }}>
      <View style={[styles.logoRow, { paddingTop: insets.top + 14 }]}>
        <Text accessibilityRole="header" style={styles.logo}>Nessential</Text>
        <Pressable accessibilityRole="button" onPress={signUp} style={styles.signUpPill}>
          <Text style={styles.signUpPillText}>Sign up</Text>
        </Pressable>
      </View>

      <View style={[styles.mascot, { top: waterline + (height - waterline) * 0.3 - nessieBox(nessieWidth).boxHeight }]}>
        <View pointerEvents="none" style={styles.rippleBox}>
          <Ring width={nessieWidth * 0.95} delay={0} reduce={reduce} />
          <Ring width={nessieWidth * 0.95} delay={2000} reduce={reduce} />
        </View>
        <JellyNessie width={nessieWidth} reduce={reduce} />
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
          <Pressable accessibilityRole="button" onPress={onContinue} style={styles.demoButton}>
            <Text style={styles.demoButtonText}>Continue in demo mode</Text>
          </Pressable>
          {notice !== '' && <Text accessibilityLiveRegion="polite" style={styles.authNotice}>{notice}</Text>}
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
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
  signIn: { width: '90%', maxWidth: 380, gap: 10 },
  authInput: { minHeight: 46, borderRadius: 10, paddingHorizontal: 14, color: '#12303A', fontSize: 16, backgroundColor: '#FFFFFF' },
  signInButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 10, backgroundColor: '#050505' },
  signInButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  demoButton: { alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  demoButtonText: {
    color: '#FFFFFF', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline',
    textShadowColor: 'rgba(8, 24, 36, 0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  authNotice: {
    color: '#FFFFFF', fontSize: 13, lineHeight: 18, textAlign: 'center',
    textShadowColor: 'rgba(8, 24, 36, 0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  logo: { color: '#050505', fontFamily: 'Jost_300Light', fontSize: 44, letterSpacing: 1.5 },
  mascot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  rippleBox: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0, alignItems: 'center' },
  ripple: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(240, 248, 248, 0.85)' },
  heroFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
});
