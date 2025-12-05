# Priceverse 2.0 - Unit Tests

Comprehensive unit test suite for the Priceverse cryptocurrency price aggregation platform.

## Test Structure

```
test/
└── unit/
    ├── contracts/
    │   ├── schemas.test.ts      # Zod schema validation tests
    │   └── errors.test.ts       # Error class tests
    ├── services/
    │   ├── stream-aggregator.test.ts   # VWAP calculation tests
    │   ├── ohlcv-aggregator.test.ts    # OHLCV candle aggregation tests
    │   ├── metrics.test.ts             # Metrics collection tests
    │   └── base-worker.test.ts         # Exchange worker base class tests
    └── shared/
        └── types.test.ts        # Type constants and interface tests
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:cov
```

## Coverage Goals

- Line Coverage: 80%
- Branch Coverage: 75%
- Function Coverage: 80%
- Statement Coverage: 80%

## Test Categories

### 1. Contract Tests (`test/unit/contracts/`)

**schemas.test.ts** - Validates Zod schemas:
- ✅ Pair, period, and interval enums
- ✅ Request parameter schemas with defaults
- ✅ Response schemas with nested objects
- ✅ Validation edge cases (min/max, array bounds)

**errors.test.ts** - Tests error classes:
- ✅ Error construction with code and message
- ✅ Error details and JSON serialization
- ✅ All error code constants
- ✅ Error inheritance and stack traces

### 2. Service Tests (`test/unit/services/`)

**stream-aggregator.test.ts** - Tests real-time VWAP calculation:
- ✅ Single and multiple trade VWAP calculation
- ✅ Volume-weighted average correctness
- ✅ Source deduplication
- ✅ Redis buffer management
- ✅ RUB conversion with CBR rates
- ✅ Price caching and publishing

**ohlcv-aggregator.test.ts** - Tests candlestick aggregation:
- ✅ OHLCV calculation from price history
- ✅ Time interval flooring (5min, 1hour, 1day)
- ✅ VWAP calculation in candles
- ✅ Candle upsert behavior
- ✅ Pagination and result formatting

**metrics.test.ts** - Tests metrics collection:
- ✅ Counter increments (prices, queries, Redis ops)
- ✅ Average calculation (DB query time)
- ✅ Cache hit rate calculation
- ✅ Exchange status tracking
- ✅ System metrics collection (memory, CPU)
- ✅ Reset functionality

**base-worker.test.ts** - Tests exchange worker base:
- ✅ Trade message parsing
- ✅ Subscribe message building
- ✅ Redis stream publishing
- ✅ Symbol lookup (forward/reverse)
- ✅ Reconnection logic with exponential backoff
- ✅ Error counting and stats

### 3. Shared Tests (`test/unit/shared/`)

**types.test.ts** - Tests type constants:
- ✅ Exchange and pair constants
- ✅ USD/RUB pair separation
- ✅ Interface structure validation
- ✅ Type uniqueness and correctness

## Mocking Strategy

All external dependencies are mocked using Vitest's `vi.mock()`:

- **Redis**: Mocked with in-memory operations
- **Database (Kysely)**: Mocked query builder chain
- **Logger**: Mocked to verify log calls
- **CBR Rate Service**: Mocked to return controlled rates

## Key Test Patterns

### 1. VWAP Calculation Accuracy

```typescript
// Tests verify formula: VWAP = Σ(price × volume) / Σ(volume)
const trades = [
  { price: 45000, volume: 1.0 },
  { price: 45100, volume: 2.0 },
  { price: 44900, volume: 1.5 },
];
// Expected: 45011.11
```

### 2. Schema Validation

```typescript
// Tests validate both success and failure cases
expect(() => PairSchema.parse('btc-usd')).not.toThrow();
expect(() => PairSchema.parse('invalid')).toThrow();
```

### 3. Edge Cases

- Zero volumes
- Empty data sets
- Null/undefined values
- Boundary conditions (min/max)
- Large numbers
- Negative values

## Adding New Tests

1. Create test file in appropriate directory
2. Use descriptive `describe()` blocks for organization
3. Write focused `it()` tests with clear assertions
4. Mock external dependencies
5. Test both success and failure paths
6. Include edge cases

Example:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MyService(/* mocked deps */);
  });

  describe('myMethod', () => {
    it('should handle valid input', () => {
      const result = service.myMethod('valid');
      expect(result).toBe('expected');
    });

    it('should throw on invalid input', () => {
      expect(() => service.myMethod('invalid')).toThrow();
    });
  });
});
```

## Continuous Integration

Tests are automatically run on:
- Pre-commit hooks (via husky)
- Pull requests (via GitHub Actions)
- Before production deployment

## Notes

- All tests use ESM modules with `.js` extensions in imports
- Test files mirror source directory structure
- Mock implementations focus on testing logic, not external services
- Coverage reports are generated in `coverage/` directory
