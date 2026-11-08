# Nessie voice: how to get it on top of the latest main

Everything for Nessie lives on the branch `nessie-voice`, cut from the latest `main`. It adds the voice backend (`services/calls`) and a small client module (`app/src/voice/`), plus a few lines in the app shell. It does not touch your screens, `backend/`, or your data code.

## 1. Pull it

```bash
git fetch origin
git checkout nessie-voice            # or: git merge origin/nessie-voice into your working branch
cd app && npm install                # adds the LiveKit packages
```

Files it changes outside the new folders: `app/index.ts` (one import), `app/app.json` (plugins, microphone text), `app/package.json` + lockfile, `app/.env.example`, `app/src/components/WaveTabBar.tsx` (Nessie button talks), `app/src/app/(tabs)/_layout.tsx` (wraps tabs in `VoiceProvider`), and `services/calls/*`. If you have local edits in those, merge by hand: the wiring is three places (below).

## 2. Keys (never commit these)

`services/calls/.env.local` (copy `.env.local.example`): `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NVIDIA_API_KEY`, `LIVEKIT_OUTBOUND_TRUNK_ID`, `CALLS_API_KEY`, `DEMO_ALLOWED_NUMBERS`, `RECOMMENDATION_API_URL`, `RECOMMENDATION_API_KEY`. Ask the owner for the values over a private channel.

`app/.env.local`: `EXPO_PUBLIC_VOICE_API_URL=http://<host>:8000` and `EXPO_PUBLIC_VOICE_API_KEY=<same as CALLS_API_KEY>` (demo shortcut: this value ends up in the served JavaScript).

## 3. Run

```bash
cd services/calls && bash scripts/dev_up.sh        # voice API :8000, dummy :9000, voice agent
cd app && CI=1 npx expo start --web --port 19006   # restart Expo after every code change
```
Open http://localhost:19006 in Chrome. Tap Nessie, speak, stop talking (it ends the turn by itself after a short pause; a second tap sends early). The answer is spoken and shown in a speech bubble.
Web works today. Native needs a development build (`npx expo run:ios`); Expo Go cannot load LiveKit.

## 4. What she knows

`services/calls/prompts/knowledge/alex.md` is a frozen snapshot of the Alex Taylor persona (balance, purchases, budgets, forecast, bills, offers). She answers from it on every screen. To change her data, edit that markdown and restart the agent (`bash scripts/dev_down.sh && bash scripts/dev_up.sh`). Answers are limited to 30 words.

## 5. If your app is wired differently (the three places)

1. Wrap the tab layout: `<VoiceProvider currentTab={routeName /* 'deals'|'spending'|'upcoming'|'account' or null */} onNavigate={openTab}>`.
2. In the Nessie button: `const voice = useVoice(); onPress={voice?.toggle}; voice?.popped` raises Nessie while she is connecting, listening, thinking or speaking.
3. `import './src/voice/setup'` as the first line of `app/index.ts`. Tabs must be named `deals`, `spending`, `upcoming`, `account` (`ROUTES` in `app/src/voice/voiceSession.ts` and `services/calls/src/navigation.py`).

## 6. Tests

```bash
cd services/calls && uv run pytest -q
cd app && node --import ./test/ts-resolve.mjs --test test/*.test.mjs
```
Headless voice check (no browser): `cd services/calls && PYTHONPATH=. uv run python scripts/app_voice_audio_smoke.py "What is my balance?"` then `grep role=assistant logs/agent.log | tail -1`.

## Known issues

- Rarely a native assertion in LiveKit's resampler (`fft4g_cache.h`) crashes the agent with a Windows dialog. Click Abort, then run `bash scripts/dev_up.sh`.
- The agent ends an idle session after 120 s; the next tap reconnects.
- NVIDIA's hosted speech-to-text occasionally errors on one turn; speaking again works.
- The old per-screen "facts" hook (`useCaptureVoiceFacts`) is kept for compatibility but no longer needed.
