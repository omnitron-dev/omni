#!/bin/bash

# Test script that mimics Claude CLI's MCP connection flow

export RUST_LOG=info
export MERIDIAN_CONFIG=/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/meridian.toml

echo "=== Testing MCP Connection Flow ==="
echo

echo "Step 1: Starting meridian server..."
SERVER_CMD="/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/target/release/meridian serve --stdio"

# Run server in background and get its PID
mkfifo /tmp/meridian_in /tmp/meridian_out 2>/dev/null || true
$SERVER_CMD < /tmp/meridian_in > /tmp/meridian_out 2>&1 &
SERVER_PID=$!

echo "Server PID: $SERVER_PID"
sleep 0.5

# Check if server is still running
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "ERROR: Server exited immediately!"
    exit 1
fi

echo "Step 2: Sending initialize request..."
INIT_REQUEST='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":true}},"clientInfo":{"name":"@modelcontextprotocol/sdk","version":"1.0.4"}}}'

echo "$INIT_REQUEST" > /tmp/meridian_in &

sleep 0.5

echo "Step 3: Reading initialize response..."
if read -t 2 RESPONSE < /tmp/meridian_out; then
    echo "Response received:"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
else
    echo "ERROR: No response within 2 seconds"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

echo
echo "Step 4: Sending notifications/initialized..."
INIT_NOTIFICATION='{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'
echo "$INIT_NOTIFICATION" > /tmp/meridian_in &

sleep 0.5

echo "Step 5: Sending tools/list request..."
TOOLS_REQUEST='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
echo "$TOOLS_REQUEST" > /tmp/meridian_in &

sleep 0.5

echo "Step 6: Reading tools/list response..."
if read -t 2 TOOLS_RESPONSE < /tmp/meridian_out; then
    echo "Tools response received:"
    echo "$TOOLS_RESPONSE" | jq '.result.tools | length' 2>/dev/null && echo "tools found"
else
    echo "ERROR: No tools response"
fi

echo
echo "Step 7: Cleaning up..."
kill $SERVER_PID 2>/dev/null
rm /tmp/meridian_in /tmp/meridian_out 2>/dev/null

echo "=== Test Complete ==="
