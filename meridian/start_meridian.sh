#!/bin/bash
# Meridian MCP Server Startup Script
# This script is configured for use with Claude Code via mcp.json

export PATH="/Users/taaliman/.cargo/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

# Optional: Use memory storage as fallback on macOS if RocksDB locking issues occur
# export MERIDIAN_FALLBACK_MEMORY=1

# Clean old locks (usually not needed with the fork detection fix)
rm -f ~/.meridian/data/LOCK ~/.meridian/data/rocksdb/LOCK ~/.meridian/global/server.pid

# Start server in MCP mode (stdio for Claude Code integration)
exec /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/target/release/meridian serve --legacy --stdio
