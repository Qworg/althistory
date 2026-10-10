#!/bin/bash

# start-local.sh - Start the complete Althistory system locally
# Usage: ./start-local.sh
# Press CTRL-C to stop all services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Store PIDs for cleanup
BACKEND_PID=""
FRONTEND_PID=""

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down services...${NC}"

    # Kill backend if running
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo -e "${BLUE}Stopping backend (PID: $BACKEND_PID)...${NC}"
        kill "$BACKEND_PID" 2>/dev/null
        wait "$BACKEND_PID" 2>/dev/null || true
        echo -e "${GREEN}Backend stopped${NC}"
    fi

    # Kill frontend if running
    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo -e "${BLUE}Stopping frontend (PID: $FRONTEND_PID)...${NC}"
        kill "$FRONTEND_PID" 2>/dev/null
        wait "$FRONTEND_PID" 2>/dev/null || true
        echo -e "${GREEN}Frontend stopped${NC}"
    fi

    # Kill any remaining child processes
    jobs -p | xargs -r kill 2>/dev/null || true

    echo -e "${GREEN}All services stopped${NC}"
    exit 0
}

# Set up trap for SIGINT (CTRL-C), SIGTERM, and EXIT
trap cleanup SIGINT SIGTERM EXIT

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse command-line options
ENABLE_TAILSCALE=false

for arg in "$@"; do
    case "$arg" in
        --tailscale|-t)
            ENABLE_TAILSCALE=true
            ;;
        --help|-h)
            echo "Usage: ./start-local.sh [options]"
            echo ""
            echo "Options:"
            echo "  --tailscale, -t    Enable Tailscale network access (binds to 0.0.0.0 and displays Tailscale URLs)"
            echo "  --help, -h         Show this help message"
            exit 0
            ;;
    esac
done

if [ "$TAILSCALE" = "true" ] || [ "$TAILSCALE" = "1" ]; then
    ENABLE_TAILSCALE=true
fi

TAILSCALE_IP=""
TAILSCALE_HOST=""

if [ "$ENABLE_TAILSCALE" = true ]; then
    if command -v tailscale >/dev/null 2>&1; then
        TAILSCALE_IP=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
        TAILSCALE_HOST=$(tailscale status --json 2>/dev/null | grep -m 1 '"HostName"' | sed -E 's/.*"HostName": "([^"]+)".*/\1/' || hostname)
    fi
    if [ -z "$TAILSCALE_IP" ] && [ -n "$CUSTOM_TAILSCALE_IP" ]; then
        TAILSCALE_IP="$CUSTOM_TAILSCALE_IP"
    fi
    if [ -z "$TAILSCALE_HOST" ]; then
        TAILSCALE_HOST=$(hostname 2>/dev/null || echo "device")
    fi

    export TAILSCALE=true
    export VITE_HOST=0.0.0.0
fi

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Althistory Local Development Mode${NC}"
if [ "$ENABLE_TAILSCALE" = true ]; then
    echo -e "${GREEN}  Tailscale Network Access: ENABLED${NC}"
fi
echo -e "${BLUE}======================================${NC}"
echo ""

# Ensure .env.local exists for backend with local execution enabled
if [ ! -f "$SCRIPT_DIR/timeline/.env.local" ]; then
    echo -e "${YELLOW}Creating timeline/.env.local for local development...${NC}"
    echo "LOCAL_EXECUTION_ENABLED=true" > "$SCRIPT_DIR/timeline/.env.local"
    echo "LOCAL_DATA_DIR=./data" >> "$SCRIPT_DIR/timeline/.env.local"
    echo "ADMIN_API_KEY=ak_althistory_local_dev_admin_key" >> "$SCRIPT_DIR/timeline/.env.local"
fi

# Ensure .env.local exists for frontend with matching local dev key and relative API base URL
if [ ! -f "$SCRIPT_DIR/frontend/.env.local" ]; then
    echo -e "${YELLOW}Creating frontend/.env.local for local development...${NC}"
    echo "VITE_API_KEY=ak_althistory_local_dev_admin_key" > "$SCRIPT_DIR/frontend/.env.local"
    echo "VITE_API_BASE_URL=/api" >> "$SCRIPT_DIR/frontend/.env.local"
else
    # Ensure VITE_API_BASE_URL is present so remote Tailscale clients proxy through Vite
    if ! grep -q "VITE_API_BASE_URL" "$SCRIPT_DIR/frontend/.env.local"; then
        echo "VITE_API_BASE_URL=/api" >> "$SCRIPT_DIR/frontend/.env.local"
    fi
fi

# Check if node_modules exist, if not run npm install
if [ ! -d "$SCRIPT_DIR/timeline/node_modules" ]; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    (cd "$SCRIPT_DIR/timeline" && npm install)
fi

if [ ! -d "$SCRIPT_DIR/frontend/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    (cd "$SCRIPT_DIR/frontend" && npm install)
fi

echo ""
echo -e "${GREEN}Starting services...${NC}"
echo ""

# Start backend server
echo -e "${BLUE}[Backend]${NC} Starting on port 3000..."
(cd "$SCRIPT_DIR/timeline" && npm run dev 2>&1 | sed 's/^/[Backend] /') &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start frontend server
echo -e "${BLUE}[Frontend]${NC} Starting on port 5173..."
(cd "$SCRIPT_DIR/frontend" && npm run dev 2>&1 | sed 's/^/[Frontend] /') &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Services started successfully!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "  ${BLUE}Local Access:${NC}"
echo -e "    Frontend App: http://localhost:5173"
echo -e "    Backend API:  http://localhost:3000"
echo ""

if [ "$ENABLE_TAILSCALE" = true ]; then
    echo -e "  ${GREEN}Tailscale Network Access:${NC}"
    if [ -n "$TAILSCALE_IP" ]; then
        echo -e "    Frontend App: ${GREEN}http://${TAILSCALE_IP}:5173${NC}"
        echo -e "    Backend API:  ${GREEN}http://${TAILSCALE_IP}:3000${NC}"
    else
        echo -e "    Frontend App: ${GREEN}http://0.0.0.0:5173${NC}"
        echo -e "    Backend API:  ${GREEN}http://0.0.0.0:3000${NC}"
    fi
    if [ -n "$TAILSCALE_HOST" ]; then
        echo -e "    MagicDNS URL: http://${TAILSCALE_HOST}:5173"
    fi
    echo ""
else
    echo -e "  ${YELLOW}Tip:${NC} Run ${BLUE}./start-local.sh --tailscale${NC} (or ${BLUE}npm run dev:tailscale${NC}) for Tailscale access."
    echo ""
fi

echo -e "${YELLOW}Press CTRL-C to stop all services${NC}"
echo ""

# Wait for any child process to exit
wait
