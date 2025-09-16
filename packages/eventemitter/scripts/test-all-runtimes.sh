#!/bin/bash

# Test script for all runtimes
# This script tests the EventEmitter package in Node.js, Bun, and Deno

set -e

echo "===================================="
echo "Testing EventEmitter in all runtimes"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if commands exist
check_command() {
    if command -v $1 &> /dev/null; then
        echo -e "${GREEN}✓${NC} $1 is installed ($(command -v $1))"
        return 0
    else
        echo -e "${YELLOW}⚠${NC} $1 is not installed"
        return 1
    fi
}

echo "Checking runtime availability..."
echo "--------------------------------"
NODE_AVAILABLE=$(check_command node && echo 1 || echo 0)
BUN_AVAILABLE=$(check_command bun && echo 1 || echo 0)
DENO_AVAILABLE=$(check_command deno && echo 1 || echo 0)
echo ""

# Test Node.js
if [ "$NODE_AVAILABLE" == "1" ]; then
    echo "Testing with Node.js..."
    echo "----------------------"
    if yarn test > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Node.js tests passed"
    else
        echo -e "${RED}✗${NC} Node.js tests failed"
        echo "Run 'yarn test' to see detailed output"
    fi
else
    echo -e "${YELLOW}⚠${NC} Skipping Node.js tests (Node.js not installed)"
fi
echo ""

# Test Bun
if [ "$BUN_AVAILABLE" == "1" ]; then
    echo "Testing with Bun..."
    echo "------------------"
    if bun test test/runtime/bun.test.ts > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Bun tests passed"
    else
        echo -e "${RED}✗${NC} Bun tests failed"
        echo "Run 'bun test test/runtime/bun.test.ts' to see detailed output"
    fi
else
    echo -e "${YELLOW}⚠${NC} Skipping Bun tests (Bun not installed)"
    echo "  Install Bun: curl -fsSL https://bun.sh/install | bash"
fi
echo ""

# Test Deno
if [ "$DENO_AVAILABLE" == "1" ]; then
    echo "Testing with Deno..."
    echo "-------------------"
    if deno test --allow-read --allow-write --allow-env test/runtime/deno.test.ts > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Deno tests passed"
    else
        echo -e "${RED}✗${NC} Deno tests failed"
        echo "Run 'deno task test' to see detailed output"
    fi
else
    echo -e "${YELLOW}⚠${NC} Skipping Deno tests (Deno not installed)"
    echo "  Install Deno: curl -fsSL https://deno.land/install.sh | sh"
fi
echo ""

echo "===================================="
echo "Test summary:"
echo "===================================="
[ "$NODE_AVAILABLE" == "1" ] && echo -e "Node.js: ${GREEN}Tested${NC}" || echo -e "Node.js: ${YELLOW}Skipped${NC}"
[ "$BUN_AVAILABLE" == "1" ] && echo -e "Bun:     ${GREEN}Tested${NC}" || echo -e "Bun:     ${YELLOW}Skipped${NC}"
[ "$DENO_AVAILABLE" == "1" ] && echo -e "Deno:    ${GREEN}Tested${NC}" || echo -e "Deno:    ${YELLOW}Skipped${NC}"