#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
PIDFILE="$ROOT/.kanban.pid"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "==> Stopping Kanban-PMP (PID $PID)..."
    kill "$PID"
    rm -f "$PIDFILE"
    echo "    Stopped."
  else
    echo "    Process $PID not running, cleaning up PID file."
    rm -f "$PIDFILE"
  fi
else
  echo "==> No PID file found. Is the server running?"
fi
