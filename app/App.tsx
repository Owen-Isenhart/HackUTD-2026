import React, { useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { Jost_300Light } from '@expo-google-fonts/jost';
import { c } from './src/theme';
import { WaveTabBar } from './src/components/WaveTabBar';
import DealsScreen from './src/screens/DealsScreen';
import SpendingScreen from './src/screens/SpendingScreen';
import UpcomingScreen from './src/screens/UpcomingScreen';
import AccountScreen from './src/screens/AccountScreen';
import SignInScreen from './src/screens/SignInScreen';

const Tab = createBottomTabNavigator();
const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: c.surface } };

export default function App() {
  const [entered, setEntered] = useState(false);
  const [loaded] = useFonts({ Jost_300Light, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
  if (!loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}>
        <ActivityIndicator color={c.secondary} />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: Platform.OS === 'web' ? '#e6e2da' : c.surface, alignItems: 'center' }}>
    <View style={{ flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 430 : undefined, overflow: 'hidden' }}>
    <SafeAreaProvider>
      {entered ? (
      <NavigationContainer theme={navTheme}>
        <Tab.Navigator
          tabBar={(p) => <WaveTabBar {...p} />}
          screenOptions={{ headerShown: false }}
        >
          <Tab.Screen name="Deals" component={DealsScreen} />
          <Tab.Screen name="Spending" component={SpendingScreen} />
          <Tab.Screen name="Upcoming" component={UpcomingScreen} />
          <Tab.Screen name="Account" component={AccountScreen} />
        </Tab.Navigator>
      </NavigationContainer>
      ) : (
        <SignInScreen onContinue={() => setEntered(true)} />
      )}
      <StatusBar style="dark" />
    </SafeAreaProvider>
    </View>
    </View>
  );
}
