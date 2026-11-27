#!/bin/bash
# Start E2E test server with clean Node.js environment

# Use the caller's Node version without inheriting test-runner preload hooks.
unset NODE_OPTIONS
exec node --no-warnings "$(dirname "$0")/simple-server.mjs"
