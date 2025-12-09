# Priceverse - Integration Tests

This directory contains integration tests for the Priceverse application modules.

## Test Files

### 1. **collector.test.ts**
Tests the Collector Module which handles exchange connections and trade data collection.

**Coverage:**
- CBR Rate Service (USD/RUB exchange rate from Central Bank of Russia)
  - Fetching rates from CBR API
  - Caching rates in Redis
  - Detecting stale rates
  - Error handling for API failures
- Exchange Manager Service
  - Starting/stopping exchange workers
  - Tracking worker statistics
  - Managing multiple exchanges
  - Handling unknown exchanges

**Key Features:**
- Mocked Redis for testing without real infrastructure
- Mocked Logger for verifying log outputs
- Tests for lifecycle hooks (@PostConstruct, @PreDestroy)
- Tests for module wiring via Dependency Injection

### 2. **aggregator.test.ts**
Tests the Aggregator Module which handles VWAP calculation and OHLCV aggregation.

**Coverage:**
- Stream Aggregator Service (Real-time VWAP calculation)
  - Creating consumer groups for Redis Streams
  - Consuming trade messages from streams
  - Calculating VWAP from buffered trades
  - Converting USD prices to RUB
  - Cleaning up old trades from buffer
  - Caching and publishing price updates
- OHLCV Aggregator Service (Candlestick data generation)
  - Aggregating 5-minute candles
  - Aggregating 1-hour candles
  - Aggregating daily candles
  - Calculating VWAP for candles
  - Handling upserts for existing candles
  - Pagination support

**Key Features:**
- Mocked Redis (xgroup, xreadgroup, zadd, zrangebyscore, etc.)
- Mocked Kysely Database connection
- Mocked CBR Rate Service for USD/RUB conversion
- Tests for data transformation and aggregation logic

### 3. **prices.test.ts**
Tests the Prices Module which provides price retrieval and streaming functionality.

**Coverage:**
- Prices Service
  - Getting prices from cache
  - Fallback to database when cache is empty
  - Rejecting stale cached prices
  - Getting multiple prices in parallel
  - Calculating price changes (24h, 7d, 30d, custom)
  - Streaming real-time price updates via Redis pub/sub
  - Error handling for cache and database failures

**Key Features:**
- Mocked Redis with cache operations
- Mocked Kysely Database for historical prices
- Tests for price staleness detection (2-minute threshold)
- Tests for concurrent requests and performance
- Tests for high-precision and large number handling

### 4. **charts.test.ts**
Tests the Charts Module which provides chart data and OHLCV candles.

**Coverage:**
- Charts Service
  - Getting chart data for different periods (24h, 7d, 30d, custom)
  - Getting chart data for different intervals (5min, 1hour, 1day)
  - Filtering candles by date range
  - Sorting candles by timestamp
  - Getting OHLCV data with pagination
  - Handling empty candle data
  - Supporting different trading pairs

**Key Features:**
- Mocked OHLCV Aggregator Service
- Tests for data transformation (OHLCV → Chart format)
- Tests for pagination and filtering
- Tests for numeric precision preservation

## Test Helper

**test-helpers.ts** - Provides utilities for creating test modules with mocked dependencies:

```typescript
import { createTestModule } from './test-helpers.js';

const testModule = createTestModule(MyModule, {
  RedisService: mockRedis,
  Logger: mockLogger,
  // ... other mocks
});

const myService = testModule.get<MyService>('MyServiceToken');
```

## Running Tests

```bash
# Run all integration tests
npm test -- test/integration

# Run specific test file
npm test -- test/integration/collector.test.ts

# Run with coverage
npm run test:cov
```

## Testing Strategy

1. **Unit of Testing**: Each test file tests one module and its services
2. **Mocking Strategy**: External dependencies (Redis, Database, APIs) are mocked
3. **Assertions**: Tests verify both behavior and interactions (via vitest spies)
4. **Lifecycle**: Tests verify @PostConstruct and @PreDestroy hooks work correctly
5. **Error Handling**: Tests ensure graceful error handling and logging

## Coverage Goals

- **Lines**: 80%
- **Branches**: 75%
- **Functions**: 80%
- **Statements**: 80%

## Key Testing Patterns

### 1. Service Resolution

```typescript
const service = testModule.get<ServiceType>(SERVICE_TOKEN);
expect(service).toBeInstanceOf(ServiceType);
```

### 2. Mock Verification

```typescript
expect(mockRedis.get).toHaveBeenCalledWith('key');
expect(mockLogger.error).toHaveBeenCalledWith(
  expect.stringContaining('error'),
  expect.any(Error)
);
```

### 3. Async Testing

```typescript
// Wait for PostConstruct lifecycle hook
await new Promise((resolve) => setTimeout(resolve, 100));

// Test async operations
await expect(service.fetchData()).resolves.not.toThrow();
```

### 4. Module Wiring

```typescript
// Verify Dependency Injection works
const container = testModule.getContainer();
const service = container.resolve(TOKEN);
expect(service).toBeDefined();
```

## Notes

- Tests use vitest for test running and mocking
- Mocks are reset between tests in `afterEach()`
- Tests are isolated - each test gets fresh mocks
- Integration tests focus on module interactions, not implementation details
- Tests use the ".js" extension for imports (ESM requirement)
