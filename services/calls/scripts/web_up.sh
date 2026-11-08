#!/usr/bin/env bash
# Starts the app's web build with the voice assistant pointed at the local voice service.
# Stops ONLY whatever already listens on the web port (a stale server serves old code), then verifies the
# served JavaScript really contains the voice code before saying it is up.
#   bash scripts/web_up.sh [port]      default 19006; voice service must be running (scripts/dev_up.sh)
set -e
cd "$(dirname "$0")/../../../app"
PORT="${1:-19006}"
LOG="../services/calls/logs/expo-web.log"
mkdir -p ../services/calls/logs
# Windows netstat lists the owner in the last column; Get-NetTCPConnection misses some IPv6 listeners.
for pid in $(netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $5 != 0 {print $5}' | sort -u); do
  echo "stopping old server on :$PORT (pid $pid)"; taskkill //F //PID "$pid" //T >/dev/null 2>&1 || true
done
sleep 2
KEY="$(grep '^CALLS_API_KEY=' ../services/calls/.env.local | cut -d= -f2)"
(CI=1 EXPO_PUBLIC_VOICE_API_URL="http://127.0.0.1:8000" EXPO_PUBLIC_VOICE_API_KEY="$KEY" \
  nohup npx expo start --web --port "$PORT" > "$LOG" 2>&1 &)
for i in $(seq 1 60); do
  body=$(curl -s -H "Accept: text/html" "http://localhost:$PORT/" 2>/dev/null | head -c 200)
  echo "$body" | grep -qi "<!doctype html" && break; sleep 3
done
SRC=$(curl -s -H "Accept: text/html" "http://localhost:$PORT/" | grep -o 'src="[^"]*bundle[^"]*"' | head -1 | sed 's/src="//;s/"$//')
TMP="../services/calls/logs/web-bundle.tmp"
curl -s -o "$TMP" -w "bundle HTTP %{http_code}\n" "http://localhost:$PORT${SRC}"
echo "voice code in served bundle: $(grep -c 'turn_ended' "$TMP") match(es) (0 = stale or wrong build)"
rm -f "$TMP"
if grep -q "is being used by another process" "$LOG"; then echo "FAILED: port $PORT is still taken; the page served is OLD code"; exit 1; fi
echo "open http://localhost:$PORT"
