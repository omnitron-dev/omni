#!/bin/bash

echo "=================================="
echo "Rotif Module Test Coverage Report"
echo "=================================="
echo ""

# Count source files
echo "Source Files:"
find src/rotif -name "*.ts" ! -name "*.d.ts" | sort
echo ""

# Count lines of code
echo "Lines of Code:"
find src/rotif -name "*.ts" ! -name "*.d.ts" -exec wc -l {} + | tail -1
echo ""

# Count test files
echo "Unit Test Files:"
ls -1 test/rotif/unit/*.spec.ts | wc -l
echo ""

# Count test cases
echo "Total Test Cases:"
grep -r "it('should" test/rotif/unit/ | wc -l
grep -r "it('should" test/rotif/*.spec.ts 2>/dev/null | wc -l | xargs -I {} echo "Integration Tests: {}"
echo ""

# Run tests with coverage
echo "Running tests with coverage..."
pnpm test test/rotif --coverage --reporter=verbose
