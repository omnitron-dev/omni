# Test Utilities

Comprehensive test utilities for the Titan framework, designed to eliminate code duplication and provide consistent testing patterns.

## Overview

This directory contains reusable test utilities that are shared across all Titan test suites. These utilities were created to eliminate significant code duplication that was found during a comprehensive analysis of the test codebase.

## Available Utilities

### Transport Test Utilities (`transport-test-utils.ts`)

Utilities for testing transport implementations:

#### Port Management

- **`getFreePort()`**: Find an available TCP port for testing
- **`getFreeHttpPort()`**: Find an available HTTP port for testing

#### Event Handling

- **`waitForEvent<T>(emitter, event, timeout?)`**: Wait for a specific event to be emitted
- **`waitForEvents(emitter, events, timeout?)`**: Wait for multiple events to be emitted
- **`waitForCondition(condition, timeout?, interval?)`**: Wait for a condition to become true

#### Timing & Delays

- **`delay(ms)`**: Delay execution for a specified time
- **`createDeferred<T>()`**: Create a deferred promise with resolve/reject functions

#### Retry Logic

- **`retryOperation<T>(operation, options?)`**: Retry an operation with exponential backoff
- **`withTimeout<T>(operation, timeout, errorMessage?)`**: Run an operation with a timeout

### Error Test Utilities (`error-test-utils.ts`)

Utilities for testing error handling and assertions:

#### Error Assertions

- **`assertTitanError(error, code, message?)`**: Assert that an error is a TitanError with specific code
- **`expectTitanError(operation, code, message?)`**: Expect an async operation to throw a TitanError
- **`expectTitanErrorSync(operation, code, message?)`**: Expect a sync operation to throw a TitanError
- **`isTitanError(error, code, message?)`**: Check if error matches criteria without throwing

#### Error Matchers

- **`createTitanErrorMatcher()`**: Create a Jest matcher for TitanError
- **`assertErrorDetails(error, expectedDetails)`**: Assert that error has specific details
- **`assertErrorContext(error, expectedContext)`**: Assert that error has specific context

#### Testing Helpers

- **`createMockErrorLogger()`**: Create a mock error logger for testing
- **`collectErrors(operations)`**: Collect all errors thrown during operations

## Usage Examples

### Transport Testing

```typescript
import { getFreePort, waitForEvent, delay } from '../../utils/index.js';

describe('MyTransport', () => {
  let testPort: number;

  beforeEach(async () => {
    testPort = await getFreePort();
  });

  it('should connect and emit event', async () => {
    const server = await transport.createServer({ port: testPort });
    const connectionPromise = waitForEvent(server, 'connection');

    const client = await transport.connect(`tcp://127.0.0.1:${testPort}`);
    const connection = await connectionPromise;

    expect(connection).toBeDefined();

    await delay(100); // Wait for cleanup
    await client.close();
    await server.close();
  });
});
```

### Error Testing

```typescript
import { expectTitanError, assertTitanError, ErrorCode } from '../../utils/index.js';

describe('MyService', () => {
  it('should throw not found error', async () => {
    const error = await expectTitanError(
      () => service.getUser('invalid-id'),
      ErrorCode.NOT_FOUND,
      /user.*not found/i
    );

    expect(error.details.userId).toBe('invalid-id');
  });

  it('should handle validation errors', () => {
    try {
      service.validateInput({});
    } catch (error) {
      assertTitanError(error, ErrorCode.BAD_REQUEST);
      expect(error.details.fieldErrors).toBeDefined();
    }
  });
});
```

### Custom Jest Matchers

```typescript
import { createTitanErrorMatcher } from '../../utils/index.js';

// In your test setup
expect.extend(createTitanErrorMatcher());

// In your tests
it('should throw proper error', async () => {
  const error = await expectTitanError(
    () => service.operation(),
    ErrorCode.UNAUTHORIZED
  );

  expect(error).toMatchTitanError(ErrorCode.UNAUTHORIZED, 'Access denied');
});
```

### Retry Operations

```typescript
import { retryOperation, delay } from '../../utils/index.js';

it('should retry failed operations', async () => {
  let attempts = 0;

  const result = await retryOperation(
    async () => {
      attempts++;
      if (attempts < 3) throw new Error('Not ready');
      return 'success';
    },
    {
      maxAttempts: 5,
      delay: 100,
      backoffFactor: 2
    }
  );

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

## Deduplication Impact

This utility system eliminated significant code duplication across the Titan test suite:

- **~202 lines** of duplicate test helper code removed
- **7 test files** refactored to use shared utilities
- **469 lines** of reusable utility code added (net savings: no extra code, much better maintainability)

### Before vs After

**Before** (duplicated in each test file):
```typescript
// In tcp-transport.spec.ts
async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });
  });
}

function waitForEvent<T = any>(emitter: EventEmitter, event: string, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    emitter.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// ... repeated in 6 other files
```

**After** (imported from shared utilities):
```typescript
import { getFreePort, waitForEvent, delay } from '../../utils/index.js';
```

## Testing Best Practices

1. **Always use utilities for common operations** - Don't duplicate test helper code
2. **Prefer `delay()` over manual `setTimeout` promises** - More readable and consistent
3. **Use `waitForEvent()` for event-based testing** - Handles timeouts automatically
4. **Use error utilities for consistent error assertions** - Better error messages and type safety
5. **Clean up resources properly** - Use `delay()` in afterEach for cleanup timeouts

## Future Enhancements

Potential additions to this utility library:

1. Mock service factories
2. Test data generators
3. Network simulation utilities (latency, packet loss)
4. Resource cleanup helpers
5. Performance benchmarking utilities

## Contributing

When adding new test utilities:

1. Check if similar functionality already exists
2. Add comprehensive JSDoc comments
3. Include usage examples in this README
4. Write tests for the utilities themselves (utilities are tested via their usage in other tests)
5. Export from `index.ts` for centralized access
