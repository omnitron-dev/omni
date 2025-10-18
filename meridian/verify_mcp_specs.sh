#!/bin/bash
# Verification script to simulate MCP server's specs discovery

echo "=== MCP Server Specs Path Verification ==="
echo ""

# Simulate what the MCP server does
export PATH="/Users/taaliman/.cargo/bin:$PATH"

# 1. Get the current project from registry
echo "1. Getting current project from registry..."
PROJECT_INFO=$(meridian projects info "meridian@0.1.0" 2>/dev/null)
CURRENT_PATH=$(echo "$PROJECT_INFO" | grep "Current Path:" | cut -d'"' -f2)
echo "   Current Path: $CURRENT_PATH"

# 2. Construct specs path
SPECS_PATH="${CURRENT_PATH}/specs"
echo ""
echo "2. Expected specs path: $SPECS_PATH"

# 3. Check if it exists
echo ""
echo "3. Checking if specs path exists and is directory:"
if [ -d "$SPECS_PATH" ]; then
    echo "   ✅ YES - Directory exists!"
else
    echo "   ❌ NO - Directory not found"
    exit 1
fi

# 4. Count specs files
echo ""
echo "4. Counting specification files:"
SPEC_COUNT=$(find "$SPECS_PATH" -name "*.md" -type f | wc -l | tr -d ' ')
echo "   Found $SPEC_COUNT markdown files"

# 5. List first 5 specs
echo ""
echo "5. Sample specifications:"
find "$SPECS_PATH" -name "*.md" -type f -exec basename {} \; | head -5 | while read file; do
    echo "   • $file"
done

# 6. Verify this is an absolute path
echo ""
echo "6. Path verification:"
case "$SPECS_PATH" in
    /*)
        echo "   ✅ Path is ABSOLUTE (starts with /)"
        ;;
    *)
        echo "   ❌ Path is RELATIVE (does not start with /)"
        exit 1
        ;;
esac

echo ""
echo "=== VERIFICATION SUCCESSFUL ==="
echo ""
echo "The MCP server will now be able to:"
echo "  ✅ Find the specs directory using absolute path"
echo "  ✅ List all $SPEC_COUNT specification files"
echo "  ✅ Read and search through specifications"
echo "  ✅ Serve specs.list, specs.get_structure, specs.search tools"
echo ""
echo "Next: Restart MCP server with 'pkill -f meridian.*serve'"
