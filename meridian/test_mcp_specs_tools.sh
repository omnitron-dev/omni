#!/bin/bash
export PATH="/Users/taaliman/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/bin:$PATH"

echo "=== Testing Meridian MCP Specs Tools ==="
echo ""

# Make sure we're in the meridian directory
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian

# Re-index to ensure current project is registered
echo "1. Re-indexing meridian project..."
meridian index . 2>&1 | tail -5

echo ""
echo "2. Checking server status..."
meridian server status | grep -A 5 "Daemon Status"

echo ""
echo "3. Listing specs files in directory..."
ls -1 specs/*.md | wc -l

echo ""
echo "4. Checking logs for specs path..."
tail -20 ~/.meridian/logs/meridian.log | grep -i "specs"

echo ""
echo "=== Test Complete ==="
echo ""
echo "Expected Results:"
echo "- Project should be indexed successfully"
echo "- Specs path should be from project registry"
echo "- Should find ~20 .md files in specs/"
echo ""
echo "Next: Use MCP tools from Claude Code to verify:"
echo "- mcp__meridian__specs_list() should return all specs"
echo "- mcp__meridian__specs_get_structure({spec_name: 'spec'}) should return TOC"
echo "- mcp__meridian__specs_search({query: 'MCP'}) should find results"
