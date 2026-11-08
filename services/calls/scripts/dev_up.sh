#!/usr/bin/env bash
# Starts everything the in-app voice profile needs, logging each service to services/calls/logs/.
#   dummy recommendation service  127.0.0.1:9000   (needs RECOMMENDATION_API_KEY from .env.local)
#   calls API incl. /voice/session  0.0.0.0:8000    (reachable from your LAN; every route except /health needs x-api-key)
#   voice agent                    registers as nessi-agent with LiveKit
# Stop with scripts/dev_down.sh. Tail logs: tail -f logs/agent.log logs/api.log logs/dummy.log
set -e
cd "$(dirname "$0")/.."
mkdir -p logs
bash scripts/dev_down.sh >/dev/null
sleep 2
REC_KEY="$(grep '^RECOMMENDATION_API_KEY=' .env.local | cut -d= -f2)"
(cd ../recommend-dummy && RECOMMENDATION_API_KEY="$REC_KEY" nohup uv run uvicorn app:app --port 9000 > ../calls/logs/dummy.log 2>&1 &)
nohup uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 > logs/api.log 2>&1 &
nohup uv run python -m src.agent start > logs/agent.log 2>&1 &
sleep 20
echo "api:   $(curl -s http://127.0.0.1:8000/health)"
echo "dummy: $(curl -s http://127.0.0.1:9000/health)"
echo "agent: $(grep -c 'registered worker' logs/agent.log) worker(s) registered"
