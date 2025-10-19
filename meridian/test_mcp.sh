#!/bin/bash
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-10-07","capabilities":{"tools":{}}},"id":1}' | ./target/release/meridian serve --legacy --stdio &
PID=$!
sleep 3
kill $PID 2>/dev/null
wait $PID 2>/dev/null
