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

echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Althistory Local Development Mode${NC}"
echo -e "${BLUE}======================================${NC}"
echo ""

# Ensure .env.local exists for backend with local execution enabled
if [ ! -f "$SCRIPT_DIR/timeline/.env.local" ]; then
    echo -e "${YELLOW}Creating timeline/.env.local for local development...${NC}"
    echo "LOCAL_EXECUTION_ENABLED=true" > "$SCRIPT_DIR/timeline/.env.local"
    echo "LOCAL_DATA_DIR=./data" >> "$SCRIPT_DIR/timeline/.env.local"
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
echo -e "${BLUE}[Backend]${NC} Starting on http://localhost:3000"
(cd "$SCRIPT_DIR/timeline" && npm run dev 2>&1 | sed 's/^/[Backend] /') &
BACKEND_PID=$!

# Give backend a moment to start
sleep 2

# Start frontend server
echo -e "${BLUE}[Frontend]${NC} Starting on http://localhost:5173"
(cd "$SCRIPT_DIR/frontend" && npm run dev 2>&1 | sed 's/^/[Frontend] /') &
FRONTEND_PID=$!

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Services started successfully!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo -e "  ${BLUE}Backend API:${NC}  http://localhost:3000"
echo -e "  ${BLUE}Frontend App:${NC} http://localhost:5173"
echo ""
echo -e "${YELLOW}Press CTRL-C to stop all services${NC}"
echo ""

# Wait for any child process to exit
wait
