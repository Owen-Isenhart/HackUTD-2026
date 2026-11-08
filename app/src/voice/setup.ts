// LiveKit needs its WebRTC globals registered once, before anything else uses it.
// Imported first in index.ts. This is native code, so it needs a development build; Expo Go
// has no WebRTC module and uses the HTTP voice path instead (useExpoVoice.ts), so skip it there.
import { isExpoGo } from './runtime';

if (!isExpoGo) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@livekit/react-native').registerGlobals();
}
