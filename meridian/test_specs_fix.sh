#!/bin/bash
# Test script to verify specs path fix

echo "=== Testing Meridian Specs Path Fix ==="
echo ""

# Set PATH
export PATH="/Users/taaliman/.cargo/bin:/opt/homebrew/bin:$PATH"

# Check meridian version
echo "1. Checking Meridian version:"
meridian --version
echo ""

# Check project info
echo "2. Checking project registry info:"
meridian projects info "meridian@0.1.0" 2>&1 | grep -A 5 "Current Path"
echo ""

# Check if specs directory exists
SPECS_DIR="/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/specs"
echo "3. Verifying specs directory exists:"
if [ -d "$SPECS_DIR" ]; then
    echo "✓ Specs directory exists: $SPECS_DIR"
    echo "  Files in specs directory:"
    ls -1 "$SPECS_DIR" | head -5
else
    echo "✗ Specs directory NOT found: $SPECS_DIR"
fi
echo ""

# Check log for absolute path
echo "4. Checking recent logs for specs path:"
LOG_FILE="/Users/taaliman/.meridian/logs/meridian.log"
if [ -f "$LOG_FILE" ]; then
    echo "  Last 'Using specs directory' log entry:"
    grep "Using specs directory from project registry" "$LOG_FILE" | tail -1
else
    echo "✗ Log file not found"
fi
echo ""

echo "=== Test Complete ==="
echo ""
echo "Expected Results:"
echo "  ✓ Current Path should be: /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian"
echo "  ✓ Specs directory should exist and contain .md files"
echo "  ✓ Log should show ABSOLUTE path (not './specs')"
echo ""
echo "Next Steps:"
echo "  1. Kill old MCP server: pkill -f 'meridian.*serve'"
echo "  2. Wait for Claude to restart the MCP server"
echo "  3. Try using specs.list MCP tool - it should now work!"
