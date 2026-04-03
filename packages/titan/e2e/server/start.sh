#!/bin/bash
# Start E2E test server with clean Node.js environment

# Clear any tsx/loader hooks
export NODE_OPTIONS=""

# Use node directly from NVM
NODE_BIN="/Users/taaliman/.nvm/versions/node/v22.19.0/bin/node"

# Run the server
exec "$NODE_BIN" --no-warnings ./simple-server.mjs
