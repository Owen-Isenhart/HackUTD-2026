// Sign-in screen: the lake background, Nessie half out of the water with a jelly wobble,
// the "Nessential" logo, a Sign up button at the top right, and username / password fields
// with a Sign in button at the bottom.
//
// Not wired into App.tsx yet. To use it:
//   1. Font: the logo uses Jost Light, a free Futura-style font. Install it with
//        npx expo install @expo-google-fonts/jost
//      and add `Jost_300Light` to the `useFonts({...})` call in App.tsx. Until then the logo
//      falls back to the system font.
//   2. Render <SignInScreen onSignIn={...} onSignUp={...} /> before the tab navigator.
//      `onSignIn` is called with the username once both fields are filled in. There is no
//      account server yet, so any filled-in username and password counts as signed in.

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ImageBackground,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const NESSIE_ASPECT = 499 / 622; // width / height of assets/nessie.png
const useNativeDriver = Platform.OS !== 'web';
const INK = '#050505'; // the near-black of the "Nessential" lettering in the brand image

// Sizes for the half-submerged Nessie. Only the top `cutFrac` of the picture is shown, as if
// the rest were under the water. `headroom` is spare space above his head so the stretch part
// of the wobble is not clipped by the box.
function nessieBox(width: number) {
  const height = width / NESSIE_ASPECT;
  const cutFrac = 0.78;
  const headroom = height * 0.16;
  return { height, cutFrac, headroom, boxHeight: headroom + height * cutFrac };
}

// Nessie wobbles like jelly, pivoting at the waterline: a slow, gentle idle sway, and a soft
// squash-and-spring when tapped. `squish` runs from -1 (squashed) to +1 (stretched tall); the
// width moves the opposite way so the body keeps its volume.
function JellyNessie({ width }: { width: number }) {
  const squish = useRef(new Animated.Value(0)).current;
  const idle = useRef<Animated.CompositeAnimation | null>(null);
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
    ]).start(({ finished }) => {
      if (finished) startIdle();
    });
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
          source={require('../../assets/nessie.png')}
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

// One ripple ring: spreads steadily outward from where Nessie goes under the water, fading as it
// goes. `delay` (in milliseconds) lets the second ring start half a cycle after the first.
function Ring({ width, delay }: { width: number; delay: number }) {
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

type Props = {
  onSignIn?: (username: string) => void;
  onSignUp?: () => void;
};

export default function SignInScreen({ onSignIn, onSignUp }: Props) {
  const insets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  // Measure the screen's own size, so it still lays out right inside a narrower web frame.
  const [size, setSize] = useState({ width: windowSize.width, height: windowSize.height });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');

  const nessieWidth = Math.min(size.width * 0.62, 300);
  const waterline = size.height * 0.5; // the water begins about halfway down the lake picture
  const cutY = waterline + (size.height - waterline) * 0.3; // where Nessie goes under

  function signIn() {
    if (!username.trim() || !password) {
      setNotice('Enter a username and password.');
      return;
    }
    setNotice('');
    onSignIn?.(username.trim());
  }

  return (
    <ImageBackground
      source={require('../../assets/lake.webp')}
      resizeMode="cover"
      style={styles.fill}
      onLayout={(e: LayoutChangeEvent) => setSize(e.nativeEvent.layout)}
    >
      <View style={[styles.topRow, { paddingTop: insets.top + 14 }]}>
        <Text accessibilityRole="header" style={styles.logo}>Nessential</Text>
        <Pressable accessibilityRole="button" onPress={onSignUp} style={styles.signUpPill}>
          <Text style={styles.signUpPillText}>Sign up</Text>
        </Pressable>
      </View>

      {/* The bottom edge of this box is the waterline Nessie goes under. */}
      <View style={[styles.mascot, { top: cutY - nessieBox(nessieWidth).boxHeight }]}>
        {/* Drawn before Nessie, so the far half of each ring passes behind his body instead of across it. */}
        <View pointerEvents="none" style={styles.rippleBox}>
          <Ring width={nessieWidth * 0.95} delay={0} />
          <Ring width={nessieWidth * 0.95} delay={2000} />
        </View>
        <JellyNessie width={nessieWidth} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}
      >
        <View style={styles.form}>
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
            style={styles.input}
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
            style={styles.input}
          />
          <Pressable accessibilityRole="button" onPress={signIn} style={styles.signInButton}>
            <Text style={styles.signInButtonText}>Sign in</Text>
          </Pressable>
          {notice !== '' && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topRow: { paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Matches the "Nessential" lettering in the brand image: thin geometric sans, near-black.
  logo: { color: INK, fontFamily: 'Jost_300Light', fontSize: 44, letterSpacing: 1.5 },
  signUpPill: {
    borderColor: 'rgba(246, 244, 239, 0.55)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 7,
    backgroundColor: 'rgba(10, 23, 32, 0.5)',
  },
  signUpPillText: { color: '#F6F4EF', fontSize: 14, fontWeight: '600' },
  mascot: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  rippleBox: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0, alignItems: 'center' },
  ripple: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(240, 248, 248, 0.85)' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  // No card behind the fields: white fields sit straight on the lake.
  form: { width: '90%', maxWidth: 380, gap: 10 },
  input: {
    minHeight: 46,
    borderRadius: 10,
    paddingHorizontal: 14,
    color: '#12303A',
    fontSize: 16,
    backgroundColor: '#FFFFFF',
  },
  signInButton: { alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 10, backgroundColor: INK },
  signInButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  notice: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    textShadowColor: 'rgba(8, 24, 36, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
