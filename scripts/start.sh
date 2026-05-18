#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
MODE="${1:-dev}"

# --- Colors ---
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

# --- Backend venv ---
BACKEND="$ROOT/backend"
VENV="$BACKEND/.venv"

if [ ! -d "$VENV" ]; then
  echo -e "${CYAN}==> Creating Python venv...${NC}"
  python3 -m venv "$VENV"
fi

source "$VENV/bin/activate"
echo -e "${CYAN}==> Installing Python dependencies...${NC}"
pip install -q -r "$BACKEND/requirements.txt"

# --- Frontend deps ---
FRONTEND="$ROOT/frontend"
if [ ! -d "$FRONTEND/node_modules" ]; then
  echo -e "${CYAN}==> Installing frontend dependencies...${NC}"
  cd "$FRONTEND" && npm install
fi

PIDFILE="$ROOT/.kanban.pid"

case "$MODE" in
  dev)
    # Kill previous instances
    if [ -f "$PIDFILE" ]; then
      OLD_PID=$(cat "$PIDFILE")
      kill "$OLD_PID" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi

    # Start backend with --reload
    cd "$BACKEND"
    echo -e "${GREEN}==> Starting backend (dev, --reload) on http://localhost:9527${NC}"
    nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 9527 --reload > "$ROOT/kanban-backend.log" 2>&1 &
    BACKEND_PID=$!

    # Start frontend dev server
    cd "$FRONTEND"
    echo -e "${GREEN}==> Starting frontend dev server...${NC}"
    nohup npm run dev > "$ROOT/kanban-frontend.log" 2>&1 &
    FRONTEND_PID=$!

    # Save both PIDs
    echo "$BACKEND_PID $FRONTEND_PID" > "$PIDFILE"

    echo ""
    echo -e "  ${GREEN}Backend${NC}  PID $BACKEND_PID  → http://localhost:9527"
    echo -e "  ${GREEN}Frontend${NC} PID $FRONTEND_PID  → http://localhost:5173 (or next available)"
    echo ""
    echo "  Logs:  $ROOT/kanban-backend.log"
    echo "         $ROOT/kanban-frontend.log"
    echo "  Stop:  bash scripts/stop.sh"
    ;;

  prod)
    # Build frontend
    echo -e "${CYAN}==> Building frontend...${NC}"
    cd "$FRONTEND" && npm run build

    # Kill previous instances
    if [ -f "$PIDFILE" ]; then
      OLD_PID=$(cat "$PIDFILE")
      kill "$OLD_PID" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi

    # Start backend only (serves API)
    cd "$BACKEND"
    echo -e "${GREEN}==> Starting backend (prod) on http://localhost:9527${NC}"
    nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 9527 > "$ROOT/kanban-backend.log" 2>&1 &
    echo $! > "$PIDFILE"

    echo ""
    echo -e "  ${GREEN}Backend${NC} PID $(cat "$PIDFILE")  → http://localhost:9527"
    echo ""
    echo "  Log:   $ROOT/kanban-backend.log"
    echo "  Stop:  bash scripts/stop.sh"
    ;;

  *)
    echo "Usage: bash scripts/start.sh [dev|prod]"
    echo "  dev   — backend (--reload) + frontend dev server (default)"
    echo "  prod  — build frontend, start backend only"
    exit 1
    ;;
esac
