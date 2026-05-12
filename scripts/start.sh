#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

# --- Backend setup ---
BACKEND="$ROOT/backend"
if [ ! -d "$BACKEND/venv" ]; then
  echo "==> Creating Python venv..."
  python3 -m venv "$BACKEND/venv"
fi

source "$BACKEND/venv/bin/activate"
echo "==> Installing Python dependencies..."
pip install -q -r "$BACKEND/requirements.txt"

# --- Frontend setup ---
FRONTEND="$ROOT/frontend"
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo "==> Installing frontend dependencies..."
  cd "$FRONTEND" && npm install
fi

echo "==> Building frontend..."
cd "$FRONTEND" && npm run build

# --- Start backend ---
cd "$BACKEND"
PIDFILE="$ROOT/.kanban.pid"
echo "==> Starting Kanban-PMP on http://localhost:9527 ..."
nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 9527 > "$ROOT/kanban.log" 2>&1 &
echo $! > "$PIDFILE"
echo "    PID: $(cat "$PIDFILE")"
echo "    Log: $ROOT/kanban.log"
echo "    Stop: bash scripts/stop.sh"
