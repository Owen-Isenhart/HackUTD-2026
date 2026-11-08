import Constants, { ExecutionEnvironment } from 'expo-constants';

/** True inside the Expo Go app, which ships no LiveKit/WebRTC native code. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
