#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# AGEM Interface — Unified Start Script
#
# Starts both the backend (Express) and frontend (Vite) dev
# servers, handles dependency installation, and cleans up
# child processes on exit.
#
# Usage:
#   ./start.sh              Start both servers
#   ./start.sh --install    Force reinstall dependencies first
#   ./start.sh --backend    Start backend only
#   ./start.sh --frontend   Start frontend only
# ──────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/interface/backend"
FRONTEND_DIR="$SCRIPT_DIR/interface/frontend"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { printf "${CYAN}[AGEM]${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}[AGEM]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[AGEM]${NC} %s\n" "$1"; }
error() { printf "${RED}[AGEM]${NC} %s\n" "$1" >&2; }

# ── Cleanup on exit ──
PIDS=()
cleanup() {
  info "Shutting down…"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  ok "All processes stopped."
}
trap cleanup EXIT INT TERM

# ── Parse args ──
RUN_BACKEND=true
RUN_FRONTEND=true
FORCE_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --install)   FORCE_INSTALL=true ;;
    --backend)   RUN_FRONTEND=false ;;
    --frontend)  RUN_BACKEND=false ;;
    --help|-h)
      echo "Usage: ./start.sh [--install] [--backend] [--frontend]"
      echo ""
      echo "  --install    Force reinstall all dependencies"
      echo "  --backend    Start backend only"
      echo "  --frontend   Start frontend only"
      echo "  -h, --help   Show this help"
      exit 0
      ;;
    *)
      error "Unknown option: $arg"
      exit 1
      ;;
  esac
done

# ── .env check ──
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    warn ".env not found — copying from .env.example"
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn "Edit .env to set your API keys and preferences"
  else
    error "No .env or .env.example found at project root"
    exit 1
  fi
fi

# ── Dependency install ──
install_deps() {
  local dir="$1"
  local name="$2"

  if [ "$FORCE_INSTALL" = true ] || [ ! -d "$dir/node_modules" ]; then
    info "Installing $name dependencies…"
    (cd "$dir" && npm install --loglevel=warn)
    ok "$name dependencies ready"
  else
    ok "$name dependencies already installed"
  fi
}

# ── Pre-flight checks ──
if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Please install Node.js v20+."
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  error "Node.js v20+ required (found v$(node -v))"
  exit 1
fi

echo ""
printf "${BOLD}╔══════════════════════════════════════╗${NC}\n"
printf "${BOLD}║        AGEM Interface Launcher        ║${NC}\n"
printf "${BOLD}╚══════════════════════════════════════╝${NC}\n"
echo ""

# ── Install ──
if [ "$RUN_BACKEND" = true ]; then
  install_deps "$BACKEND_DIR" "Backend"
fi
if [ "$RUN_FRONTEND" = true ]; then
  install_deps "$FRONTEND_DIR" "Frontend"
fi

echo ""

# ── Start backend ──
if [ "$RUN_BACKEND" = true ]; then
  info "Starting backend (Express on port ${PORT:-8000})…"
  (cd "$BACKEND_DIR" && npm run dev) &
  PIDS+=($!)
fi

# ── Start frontend ──
if [ "$RUN_FRONTEND" = true ]; then
  info "Starting frontend (Vite on port 5173)…"
  (cd "$FRONTEND_DIR" && npm run dev) &
  PIDS+=($!)
fi

echo ""
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$RUN_BACKEND" = true ]; then
  ok "Backend API:  http://localhost:${PORT:-8000}"
fi
if [ "$RUN_FRONTEND" = true ]; then
  ok "Frontend UI:  http://localhost:5173"
fi
ok "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "Press Ctrl+C to stop all servers"
echo ""

# ── Wait for children ──
wait
