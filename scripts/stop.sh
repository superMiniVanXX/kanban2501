#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
PIDFILE="$ROOT/.kanban.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "==> No PID file found. Is the server running?"
  exit 0
fi

# Read all PIDs (may be one or two, space-separated)
PIDS=$(cat "$PIDFILE")

for PID in $PIDS; do
  if kill -0 "$PID" 2>/dev/null; then
    echo "==> Stopping process $PID..."
    kill "$PID" 2>/dev/null || true
  else
    echo "    Process $PID not running, skipping."
  fi
done

# Also try to kill any leftover uvicorn/vite processes on our ports
for PORT in 9527 5173; do
  PID=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "==> Killing leftover process on port $PORT (PID $PID)..."
    kill $PID 2>/dev/null || true
  fi
done

rm -f "$PIDFILE"
echo "==> Stopped."
