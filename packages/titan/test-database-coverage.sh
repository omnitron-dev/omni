#!/bin/bash

echo "========================================="
echo "Database Module Test Coverage Summary"
echo "========================================="
echo ""

echo "Running all database unit tests..."
npm test -- \
  test/modules/database/transaction-manager-unit.spec.ts \
  test/modules/database/database-manager-unit.spec.ts \
  test/modules/database/repository-factory-unit.spec.ts \
  test/modules/database/database-service-unit.spec.ts \
  test/modules/database/database-health-unit.spec.ts \
  --coverage \
  --collectCoverageFrom='src/modules/database/**/*.ts' \
  --collectCoverageFrom='!src/modules/database/**/*.types.ts' \
  --collectCoverageFrom='!src/modules/database/**/index.ts' \
  --collectCoverageFrom='!src/modules/database/plugins/examples/**' \
  --coverageReporters=text \
  --coverageReporters=json-summary \
  --passWithNoTests \
  2>&1 | tee /tmp/database-coverage-output.log

echo ""
echo "========================================="
echo "Test Files Created:"
echo "========================================="
ls -lh test/modules/database/*-unit.spec.ts

echo ""
echo "========================================="
echo "Line Counts:"
echo "========================================="
wc -l test/modules/database/*-unit.spec.ts | tail -1
