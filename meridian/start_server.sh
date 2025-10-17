#!/usr/bin/env bash
#
# Meridian MCP Server Startup Script
# Starts the Meridian HTTP server with proper environment setup
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Environment setup
export PATH="/Users/taaliman/.cargo/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

echo -e "${GREEN}🚀 Meridian MCP Server${NC}"
echo "================================"

# Check if binary exists
if [ ! -f "target/release/meridian" ]; then
    echo -e "${YELLOW}⚙️  Building Meridian...${NC}"
    cargo build --release

    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Build failed${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ Build successful${NC}"
fi

# Check configuration
if [ ! -f "meridian.toml" ]; then
    echo -e "${RED}❌ Configuration file meridian.toml not found${NC}"
    exit 1
fi

# Parse port from config (default 3000)
PORT=$(grep -A 5 '\[mcp.http\]' meridian.toml | grep 'port' | awk '{print $3}' || echo "3000")

echo ""
echo -e "${GREEN}📝 Configuration:${NC}"
echo "   • Config: meridian.toml"
echo "   • Port: $PORT"
echo "   • Transport: HTTP/SSE"
echo ""

# Check if port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}⚠️  Port $PORT is already in use${NC}"
    echo "   Kill the existing process? (y/n)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}   Killing process on port $PORT...${NC}"
        lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
        sleep 1
    else
        echo -e "${RED}❌ Exiting${NC}"
        exit 1
    fi
fi

# Create .meridian directory if it doesn't exist
mkdir -p .meridian

echo -e "${GREEN}🌟 Starting Meridian HTTP server...${NC}"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Start the server
./target/release/meridian serve --http

# If the server exits unexpectedly
echo ""
echo -e "${RED}❌ Server stopped${NC}"
