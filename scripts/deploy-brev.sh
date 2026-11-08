#!/usr/bin/env bash
# Deploy the finance backend + optimizer to the Brev host. Run from WSL.
set -euo pipefail

HOST="${HOST:-following-copper-silkworm}"
DEST="${DEST:-~/.local/share/hackutd-finance-next}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp /tmp/finance.XXXXXX.tgz)"
trap 'rm -f "$TMP"' EXIT

cd "$ROOT"
tar czf "$TMP" --exclude='optimizer/.venv' --exclude='__pycache__' \
  backend scripts data package.json package-lock.json optimizer
scp -q "$TMP" "$HOST:/tmp/finance.tgz"

ssh "$HOST" "DEST='$DEST' bash -s" <<'REMOTE'
set -euo pipefail
DEST="${DEST/#\~/$HOME}"
export PATH="$HOME/.local/share/hackutd-finance/runtime/node/bin:$HOME/.local/bin:$PATH"
mkdir -p "$DEST"
cd "$DEST"

old_lock=""
[ -f package-lock.json ] && old_lock="$(sha256sum package-lock.json | cut -d' ' -f1)"
tar xzf /tmp/finance.tgz -C "$DEST"
new_lock="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ "$old_lock" != "$new_lock" ] || [ ! -d node_modules ]; then
  npm ci --omit=dev
fi

node --env-file=.env scripts/finance-profile.js --migrate

env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }

# Optimizer
OPTIMIZER_API_KEY="$(env_get OPTIMIZER_API_KEY)"
export OPTIMIZER_API_KEY
pkill -f 'optimizer.server' 2>/dev/null || true
(
  cd optimizer
  uv sync --frozen --no-dev -q
  OPTIMIZER_PORT=8789 \
  NEMOTRON_BASE_URL=http://127.0.0.1:8000/v1 NEMOTRON_MODEL=nemotron-bolt \
  nohup uv run --no-dev python -m optimizer.server > optimizer.log 2>&1 < /dev/null &
)

# Finance server: only processes whose cwd is DEST
for pid in $(pgrep -f 'finance-profile.js --serve' || true); do
  if [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$(readlink -f "$DEST")" ]; then
    kill "$pid" || true
  fi
done
sleep 1
nohup node --env-file=.env scripts/finance-profile.js --serve > serve.log 2>&1 < /dev/null &

FINANCE_PORT="$(env_get FINANCE_PORT)"; FINANCE_PORT="${FINANCE_PORT:-8787}"
sleep 4
for p in health ready; do
  echo "== /$p"
  curl -s -w '\nHTTP %{http_code}\n' "http://127.0.0.1:$FINANCE_PORT/$p" || echo "curl failed"
done
echo "== tunnel"
curl -s 127.0.0.1:20241/quicktunnel || true
echo
REMOTE
