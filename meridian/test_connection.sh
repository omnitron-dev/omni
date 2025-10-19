#!/bin/bash

# Test script to verify RPC server is listening and accepting connections

set -e

SOCKET_PATH="/Users/taaliman/.meridian/global/meridian.sock"

echo "=== Testing RPC Server Connection ==="
echo ""

# 1. Check if socket file exists
echo "1. Checking socket file..."
if [ -S "$SOCKET_PATH" ]; then
    echo "   ✓ Socket file exists: $SOCKET_PATH"
else
    echo "   ✗ Socket file not found: $SOCKET_PATH"
    exit 1
fi

# 2. Check if something is listening on the socket
echo ""
echo "2. Checking if socket is being listened on..."
if lsof "$SOCKET_PATH" > /dev/null 2>&1; then
    echo "   ✓ Socket is being listened on"
    lsof "$SOCKET_PATH" | grep meridian
else
    echo "   ✗ Socket is not being listened on"
    exit 1
fi

# 3. Try to connect with a simple Rust test
echo ""
echo "3. Testing connection with Rust client..."
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian

cat > /tmp/test_rpc_connection.rs << 'EOF'
use meridian::rpc::RpcClient;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let socket_path = "/Users/taaliman/.meridian/global/meridian.sock";
    let socket_url = format!("unix://{}", socket_path);

    println!("Attempting to connect to: {}", socket_url);

    match RpcClient::connect(&socket_url).await {
        Ok(_client) => {
            println!("✓ Successfully connected to RPC server!");
            Ok(())
        }
        Err(e) => {
            println!("✗ Failed to connect: {}", e);
            Err(e)
        }
    }
}
EOF

echo "   Building and running test..."
rustc --edition 2021 \
    --extern meridian=/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/target/release/libmeridian.rlib \
    --extern tokio \
    --extern anyhow \
    -L /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/target/release/deps \
    /tmp/test_rpc_connection.rs \
    -o /tmp/test_rpc_connection 2>&1

if [ $? -eq 0 ]; then
    /tmp/test_rpc_connection
else
    echo "   (Compilation failed, trying with cargo run instead)"
    # Fallback: create a simple test binary
fi

echo ""
echo "=== Test Complete ==="
