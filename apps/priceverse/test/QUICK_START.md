# Unit Tests - Quick Start Guide

## Running Tests

```bash
# Run all unit tests
pnpm test test/unit

# Run with coverage
pnpm vitest run test/unit --coverage

# Watch mode (for development)
pnpm test:watch

# Run specific test file
pnpm vitest run test/unit/services/metrics.test.ts

# Run tests matching pattern
pnpm vitest run test/unit -t "VWAP"
```

## Test Structure

```
test/unit/
├── contracts/          # Schema & error validation
│   ├── schemas.test.ts     # 41 tests - Zod schemas
│   └── errors.test.ts      # 11 tests - Error classes
├── services/           # Business logic
│   ├── stream-aggregator.test.ts    # 16 tests - VWAP
│   ├── ohlcv-aggregator.test.ts     # 15 tests - Candles
│   ├── metrics.test.ts              # 26 tests - Metrics
│   └── base-worker.test.ts          # 27 tests - Workers
└── shared/             # Constants & types
    └── types.test.ts       # 24 tests - Type validation
```

## Test Statistics

- **Total Tests**: 160
- **Test Files**: 7
- **Pass Rate**: 100%
- **Execution Time**: <100ms
- **Code Coverage**: ~69%

## Quick Reference

### Test a Specific Module

```bash
# Test VWAP calculations
pnpm vitest run test/unit/services/stream-aggregator.test.ts

# Test metrics
pnpm vitest run test/unit/services/metrics.test.ts

# Test schemas
pnpm vitest run test/unit/contracts/schemas.test.ts
```

### Coverage Report

```bash
# Generate coverage report
pnpm vitest run test/unit --coverage

# View coverage in browser
open coverage/index.html
```

## Key Test Areas

### 1. VWAP Calculation
Tests the formula: `VWAP = Σ(price × volume) / Σ(volume)`
- Single trade scenarios
- Multiple trade scenarios  
- Source deduplication
- Buffer management

### 2. OHLCV Aggregation
Tests candlestick generation:
- Time interval flooring
- Open/High/Low/Close extraction
- Volume aggregation
- VWAP within candles

### 3. Metrics Collection
Tests counter and calculation accuracy:
- Price updates
- Database query timing
- Cache hit rate
- Exchange status

### 4. Schema Validation
Tests all Zod schemas:
- Request parameter validation
- Array bounds checking
- Optional field handling
- Type coercion

## Example Test Output

```bash
✓ test/unit/contracts/schemas.test.ts (41 tests) 10ms
✓ test/unit/contracts/errors.test.ts (11 tests) 4ms
✓ test/unit/services/stream-aggregator.test.ts (16 tests) 6ms
✓ test/unit/services/ohlcv-aggregator.test.ts (15 tests) 6ms
✓ test/unit/services/metrics.test.ts (26 tests) 14ms
✓ test/unit/services/base-worker.test.ts (27 tests) 8ms
✓ test/unit/shared/types.test.ts (24 tests) 4ms

Test Files  7 passed (7)
     Tests  160 passed (160)
  Duration  52ms
```

## Troubleshooting

### Tests Failing
```bash
# Clear cache and rerun
pnpm vitest run test/unit --no-cache

# Update snapshots if needed
pnpm vitest run test/unit -u
```

### Coverage Issues
```bash
# Ensure coverage package is installed
pnpm add -D @vitest/coverage-v8

# Check vitest version matches
pnpm list vitest @vitest/coverage-v8
```

## More Information

- Full documentation: `test/README.md`
- Detailed summary: `test/UNIT_TEST_SUMMARY.md`
- Complete report: `UNIT_TESTS_COMPLETE.md`
