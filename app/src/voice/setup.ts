// LiveKit needs its WebRTC globals registered once, before anything else uses it.
// Imported first in index.ts. This is native code, so it needs a development build (not Expo Go).
import { registerGlobals } from '@livekit/react-native';

registerGlobals();
