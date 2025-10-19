#!/bin/bash
export PATH="/Users/taaliman/.cargo/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

echo "Testing Meridian MCP server..."

# Test 1: Check if binary exists
if [ ! -f ./target/release/meridian ]; then
    echo "ERROR: Binary not found at ./target/release/meridian"
    exit 1
fi
echo "✓ Binary exists"

# Test 2: Check binary is executable
if [ ! -x ./target/release/meridian ]; then
    echo "ERROR: Binary is not executable"
    exit 1
fi
echo "✓ Binary is executable"

# Test 3: Try to run with --help
echo ""
echo "Testing --help flag:"
./target/release/meridian serve --help
echo ""

# Test 4: Test with a simple initialization message
echo "Testing JSON-RPC initialization (will send message and exit after 2s)..."
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-10-07","capabilities":{"tools":{}}},"id":1}' > /tmp/test_init.json

# Run in background, capture output, kill after 2 seconds
./target/release/meridian serve --legacy --stdio < /tmp/test_init.json > /tmp/test_output.json 2> /tmp/test_error.log &
PID=$!
echo "Started process $PID, waiting 2 seconds..."
sleep 2

# Check if process is still running
if ps -p $PID > /dev/null 2>&1; then
    echo "Process is running, killing it..."
    kill $PID 2>/dev/null
    sleep 1
    # Force kill if still alive
    if ps -p $PID > /dev/null 2>&1; then
        echo "Force killing..."
        kill -9 $PID 2>/dev/null
    fi
fi

echo ""
echo "=== OUTPUT ==="
cat /tmp/test_output.json
echo ""
echo "=== ERRORS ==="
cat /tmp/test_error.log
echo ""

# Cleanup
rm -f /tmp/test_init.json /tmp/test_output.json /tmp/test_error.log

echo "Test complete"
