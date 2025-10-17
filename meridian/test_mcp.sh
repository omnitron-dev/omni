#!/bin/bash
# MCP Server Test Suite for Meridian
set -e

export PATH="/Users/taaliman/.cargo/bin:/usr/local/bin:/bin:/usr/bin:$PATH"
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian

MERIDIAN="./target/release/meridian"
LOG_FILE=".meridian/logs/meridian.log"

echo "=== Meridian MCP Server Test Suite ==="
echo ""

# Clean up old logs
rm -rf .meridian/logs
mkdir -p .meridian/logs

# Test 1: Initialize
echo "Test 1: Initialize Request"
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{"roots":{"listChanged":true},"sampling":{}},"clientInfo":{"name":"test-client","version":"1.0.0"}}}' | $MERIDIAN serve --stdio > /tmp/test1.json &
PID=$!
sleep 1
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
cat /tmp/test1.json
echo ""
echo ""

# Test 2: Tools List
echo "Test 2: Tools List Request"
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}'
) | $MERIDIAN serve --stdio > /tmp/test2.json &
PID=$!
sleep 2
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
cat /tmp/test2.json
echo ""
echo ""

# Test 3: Code Search Symbols
echo "Test 3: Code Search Symbols Tool"
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"code.search_symbols","arguments":{"query":"main","symbol_types":["function"]}}}'
) | $MERIDIAN serve --stdio > /tmp/test3.json &
PID=$!
sleep 2
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
cat /tmp/test3.json
echo ""
echo ""

# Test 4: Session Begin
echo "Test 4: Session Begin Tool"
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"session.begin","arguments":{"context":"Testing MCP server","goal":"Verify functionality"}}}'
) | $MERIDIAN serve --stdio > /tmp/test4.json &
PID=$!
sleep 2
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
cat /tmp/test4.json
echo ""
echo ""

# Test 5: Memory Statistics
echo "Test 5: Memory Get Statistics Tool"
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory.get_statistics","arguments":{}}}'
) | $MERIDIAN serve --stdio > /tmp/test5.json &
PID=$!
sleep 2
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
cat /tmp/test5.json
echo ""
echo ""

# Test 6: Invalid Method Error Handling
echo "Test 6: Invalid Method Error Handling"
(
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'
  echo '{"jsonrpc":"2.0","id":2,"method":"notifications/initialized","params":{}}'
  echo '{"jsonrpc":"2.0","id":3,"method":"invalid.method","params":{}}'
) | $MERIDIAN serve --stdio > /tmp/test6.json &
PID=$!
sleep 2
kill $PID 2>/dev/null || true
wait $PID 2>/dev/null || true
cat /tmp/test6.json
echo ""
echo ""

# Test 7: Check Logging to File
echo "Test 7: Verify Logs Go to File (Not Stdout)"
if [ -f "$LOG_FILE" ]; then
  echo "✅ Log file exists: $LOG_FILE"
  echo "Log file size: $(wc -c < $LOG_FILE) bytes"
  echo "Recent log entries:"
  tail -20 "$LOG_FILE" 2>/dev/null || echo "Could not read log file"
else
  echo "⚠️  Log file not found: $LOG_FILE"
fi
echo ""

echo "=== Test Suite Complete ==="
