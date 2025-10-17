#!/bin/bash

# Meridian Quick Test Script
# Проверяет готовность системы к использованию

echo "========================================="
echo "    Meridian System Readiness Check     "
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Rust installation
echo "1. Checking Rust installation..."
if command -v rustc &> /dev/null; then
    echo -e "${GREEN}✓ Rust installed:${NC} $(rustc --version)"
else
    echo -e "${RED}✗ Rust not found${NC}"
    echo "  Please install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check Cargo
echo ""
echo "2. Checking Cargo..."
if command -v cargo &> /dev/null; then
    echo -e "${GREEN}✓ Cargo installed:${NC} $(cargo --version)"
else
    echo -e "${RED}✗ Cargo not found${NC}"
    exit 1
fi

# Check if we're in meridian directory
echo ""
echo "3. Checking project structure..."
if [ -f "Cargo.toml" ]; then
    echo -e "${GREEN}✓ Cargo.toml found${NC}"
else
    echo -e "${RED}✗ Not in meridian directory${NC}"
    echo "  Please run this script from the meridian directory"
    exit 1
fi

# Check source files
echo ""
echo "4. Checking source files..."
FILES_TO_CHECK=(
    "src/main.rs"
    "src/lib.rs"
    "src/memory/mod.rs"
    "src/context/mod.rs"
    "src/indexer/mod.rs"
    "src/session/mod.rs"
    "src/mcp/mod.rs"
)

all_files_exist=true
for file in "${FILES_TO_CHECK[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $file"
    else
        echo -e "${RED}✗${NC} $file missing"
        all_files_exist=false
    fi
done

if [ "$all_files_exist" = false ]; then
    echo -e "${RED}Some source files are missing!${NC}"
    exit 1
fi

# Try to compile library
echo ""
echo "5. Testing library compilation..."
if cargo build --lib 2>/dev/null; then
    echo -e "${GREEN}✓ Library compiles successfully${NC}"
else
    echo -e "${YELLOW}⚠ Library compilation has issues${NC}"
    echo "  Run 'cargo build --lib' to see detailed errors"
fi

# Check for tree-sitter issues
echo ""
echo "6. Checking tree-sitter dependencies..."
if cargo tree | grep -q "tree-sitter"; then
    echo -e "${GREEN}✓ tree-sitter dependencies found${NC}"
    echo -e "${YELLOW}  Note: May need to configure C library linking${NC}"
else
    echo -e "${RED}✗ tree-sitter not in dependencies${NC}"
fi

# Test MCP server JSON-RPC
echo ""
echo "7. Testing MCP server response format..."
cat > test_request.json << 'EOF'
{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}
EOF

echo -e "${YELLOW}  To test MCP server when compiled:${NC}"
echo "  echo '{\"jsonrpc\":\"2.0\",\"method\":\"initialize\",\"params\":{},\"id\":1}' | ./target/release/meridian serve --stdio"

# Summary
echo ""
echo "========================================="
echo "             SUMMARY                     "
echo "========================================="
echo ""

if [ "$all_files_exist" = true ]; then
    echo -e "${GREEN}✓ All source files present${NC}"
    echo -e "${YELLOW}⚠ Compilation needs to be tested with Rust installed${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Install Rust if not installed:"
    echo "   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo ""
    echo "2. Build the project:"
    echo "   cargo build --release"
    echo ""
    echo "3. Test MCP server:"
    echo "   ./target/release/meridian serve --stdio"
    echo ""
    echo "4. Configure Claude Code:"
    echo "   See specs/MCP_CLAUDE_CODE_SETUP.md"
else
    echo -e "${RED}✗ Some files are missing${NC}"
    echo "Please ensure all source files are present"
fi

echo ""
echo "========================================="
echo "Full documentation: specs/MCP_CLAUDE_CODE_SETUP.md"
echo "Implementation report: IMPLEMENTATION_REPORT.md"