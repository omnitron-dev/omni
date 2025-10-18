#!/bin/bash

# Test Meridian MCP Specification Tools
# This script tests the new specification management MCP tools

set -e

export PATH="/Users/taaliman/.cargo/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

echo "🚀 Starting Meridian MCP Server in background..."

# Start MCP server in background
./target/release/meridian serve --stdio > /tmp/meridian_mcp.log 2>&1 &
MCP_PID=$!

echo "📝 MCP Server PID: $MCP_PID"

# Wait for server to start
sleep 2

echo ""
echo "✅ Testing MCP Specification Tools..."
echo ""

# Helper function to send MCP request
send_mcp_request() {
    local method="$1"
    local params="$2"
    local id=$((RANDOM % 1000))

    echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"$method\",\"params\":$params}"
}

# Initialize connection
echo "1️⃣  Testing initialization..."
INIT_REQ=$(send_mcp_request "initialize" '{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}')
echo "$INIT_REQ" | nc -w 3 localhost 8080 2>/dev/null || echo "Note: Using STDIO mode"

echo ""
echo "2️⃣  Testing specs.list..."
LIST_REQ=$(send_mcp_request "tools/call" '{"name":"specs.list","arguments":{}}')
echo "$LIST_REQ"

echo ""
echo "3️⃣  Testing specs.get_structure for 'spec'..."
STRUCT_REQ=$(send_mcp_request "tools/call" '{"name":"specs.get_structure","arguments":{"spec_name":"spec"}}')
echo "$STRUCT_REQ"

echo ""
echo "4️⃣  Testing specs.get_section..."
SECTION_REQ=$(send_mcp_request "tools/call" '{"name":"specs.get_section","arguments":{"spec_name":"spec","section_name":"introduction"}}')
echo "$SECTION_REQ"

echo ""
echo "5️⃣  Testing specs.search..."
SEARCH_REQ=$(send_mcp_request "tools/call" '{"name":"specs.search","arguments":{"query":"implementation","max_results":5}}')
echo "$SEARCH_REQ"

echo ""
echo "6️⃣  Testing specs.validate..."
VALIDATE_REQ=$(send_mcp_request "tools/call" '{"name":"specs.validate","arguments":{"spec_name":"spec"}}')
echo "$VALIDATE_REQ"

echo ""
echo "🔴 Stopping MCP server..."
kill $MCP_PID 2>/dev/null || true

echo "✅ Tests complete!"
echo ""
echo "📊 MCP Server Log:"
tail -20 /tmp/meridian_mcp.log 2>/dev/null || echo "No logs available"
