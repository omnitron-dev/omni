# Netron Browser Testing Infrastructure

This directory contains comprehensive E2E and integration tests for the Netron Browser client, validating full compatibility between the browser client and Titan server.

## Test Structure

```
tests/
├── fixtures/               # Test fixtures and utilities
│   ├── test-services.ts   # Test service implementations
│   ├── titan-server.ts    # Titan server fixture
│   ├── test-app.html      # Browser test page
│   ├── test-client.ts     # Browser client script
│   ├── build.ts           # Build script for test client
│   └── serve.ts           # Static file server for E2E tests
├── e2e/                   # Playwright E2E tests
│   └── browser-server.spec.ts  # Browser-server integration tests
├── integration/           # Node.js integration tests
│   └── client-server.test.ts   # Client-server integration tests
└── unit/                  # Unit tests
    ├── client.test.ts
    └── utils.test.ts
```

## Test Types

### 1. Unit Tests

Fast, isolated tests for individual components.

**Run:**
```bash
npm run test:unit
```

**Coverage:**
- Client classes (HttpClient, WebSocketClient)
- Utility functions
- Type guards and helpers

### 2. Integration Tests

Tests that validate client-server communication in Node.js environment.

**Run:**
```bash
npm run test:integration
```

**Features:**
- HTTP client with Titan server
- WebSocket client with Titan server
- Mixed transport tests
- Service method invocations
- Error handling
- Performance testing

**Benefits:**
- Faster than E2E tests
- No browser overhead
- Better debugging
- Can run in CI easily

### 3. E2E Tests (Playwright)

Full browser-based tests using Playwright.

**Run:**
```bash
npm run test:e2e           # Run all E2E tests
npm run test:e2e:ui        # Run with UI
npm run test:e2e:debug     # Debug mode
```

**Coverage:**
- Real browser environment (Chromium, Firefox, Safari)
- UI interaction testing
- HTTP and WebSocket transports
- Connection management
- Service method calls
- Error handling
- Performance tests

## Test Services

The test suite includes several service implementations:

### CalculatorService (`calculator@1.0.0`)
- `add(a, b)` - Add two numbers
- `subtract(a, b)` - Subtract two numbers
- `multiply(a, b)` - Multiply two numbers
- `divide(a, b)` - Divide two numbers (throws on division by zero)
- `addAsync(a, b)` - Async addition

### UserService (`user@1.0.0`)
- `getUser(id)` - Get user by ID
- `createUser(data)` - Create new user
- `listUsers()` - List all users
- `updateUser(id, data)` - Update user
- `deleteUser(id)` - Delete user

### EchoService (`echo@1.0.0`)
- `echo(message)` - Echo any value
- `echoString(message)` - Echo string
- `echoNumber(value)` - Echo number
- `echoBoolean(value)` - Echo boolean
- `echoObject(obj)` - Echo object
- `echoArray(arr)` - Echo array
- `echoAsync(message)` - Async echo
- `throwError(message)` - Throw error for testing

### StreamService (`stream@1.0.0`)
- `generateNumbers(count)` - Generate array of numbers
- `generateData(count)` - Generate array of data objects

## Running Tests

### All Tests
```bash
npm run test:all
```

This runs unit tests, integration tests, and E2E tests in sequence.

### Individual Test Suites

```bash
# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# E2E tests only
npm run test:e2e
```

### Development Mode

```bash
# Watch mode for unit/integration tests
npm run test

# Interactive UI for unit tests
npm run test:ui

# Playwright UI mode
npm run test:e2e:ui

# Debug mode
npm run test:e2e:debug
```

### Coverage

```bash
npm run test:coverage
```

## Fixtures

### Titan Server Fixture

`tests/fixtures/titan-server.ts` provides utilities for creating test servers:

```typescript
import { createTitanServer } from './fixtures/titan-server';

const server = await createTitanServer({
  port: 0,              // Random port
  enableHttp: true,
  enableWebSocket: true,
  logLevel: 'silent',
});

// Use server
console.log(server.httpUrl);  // http://localhost:PORT
console.log(server.wsUrl);    // ws://localhost:PORT

// Cleanup
await server.cleanup();
```

### Test Client (Browser)

`tests/fixtures/test-client.ts` provides a browser-based test client that:
- Connects to the server
- Provides UI controls for testing
- Logs all operations
- Exposes API for Playwright tests

### Build Scripts

```bash
# Build test client bundle
npm run test:e2e:build

# Start E2E test server (Titan + static files)
npm run test:e2e:serve
```

## Playwright Configuration

The Playwright config (`playwright.config.ts`) includes:

- **Browsers**: Chromium, Firefox, Safari
- **Timeouts**: 30s test timeout, 5s expect timeout
- **Screenshots**: On failure
- **Video**: On failure
- **Traces**: On first retry
- **Web Server**: Automatically starts `test:e2e:serve`

## CI/CD Integration

The test suite is designed for CI/CD:

```yaml
# Example GitHub Actions
- name: Install dependencies
  run: yarn install

- name: Build
  run: yarn build

- name: Run unit tests
  run: yarn test:unit

- name: Run integration tests
  run: yarn test:integration

- name: Install Playwright
  run: npx playwright install --with-deps

- name: Run E2E tests
  run: yarn test:e2e
```

## Test Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always cleanup resources in `afterAll`/`afterEach`
3. **Timeouts**: Use appropriate timeouts for async operations
4. **Error Testing**: Test both success and failure cases
5. **Performance**: Include performance benchmarks where relevant

## Debugging

### Integration Tests

```bash
# Run specific test file
npm run test:integration -- client-server.test.ts

# Run with verbose output
npm run test:integration -- --reporter=verbose

# Debug in VS Code
# Use VS Code's built-in Vitest debugger
```

### E2E Tests

```bash
# Debug mode (step through tests)
npm run test:e2e:debug

# UI mode (visual test runner)
npm run test:e2e:ui

# Run specific test
npm run test:e2e -- browser-server.spec.ts

# Run specific browser
npm run test:e2e -- --project=chromium
```

### Manual Testing

```bash
# Start the test server manually
npm run test:e2e:serve

# Then open http://localhost:3000 in your browser
# Use the UI to test different operations
```

## Common Issues

### Port Already in Use

The server uses port 3000 by default. If it's already in use:

```bash
PORT=3001 npm run test:e2e:serve
```

### WebSocket Connection Errors

If WebSocket tests fail:
- Check firewall settings
- Ensure the server is running
- Check browser console for errors

### Build Errors

If the test client build fails:

```bash
# Clean and rebuild
npm run clean
npm run build
npm run test:e2e:build
```

## Example Test Output

### Integration Tests
```
 ✓ tests/integration/client-server.test.ts (45)
   ✓ HTTP Client Integration (30)
     ✓ Calculator Service (6)
       ✓ should add two numbers
       ✓ should subtract two numbers
       ✓ should multiply two numbers
       ✓ should divide two numbers
       ✓ should handle division by zero
       ✓ should handle async operations
     ✓ User Service (6)
       ✓ should get a user by id
       ✓ should list all users
       ...

 Test Files  1 passed (1)
      Tests  45 passed (45)
   Start at  10:00:00
   Duration  2.34s
```

### E2E Tests
```
Running 15 tests using 3 workers

  ✓ [chromium] › browser-server.spec.ts:3:1 › should connect via HTTP (1.2s)
  ✓ [chromium] › browser-server.spec.ts:15:1 › should perform calculator operations (2.1s)
  ✓ [firefox] › browser-server.spec.ts:3:1 › should connect via HTTP (1.3s)
  ...

  15 passed (45s)
```

## Future Enhancements

- [ ] Add streaming tests when streaming is implemented
- [ ] Add authentication/authorization tests
- [ ] Add compression tests
- [ ] Add connection pooling tests
- [ ] Add stress tests
- [ ] Add visual regression tests

## Contributing

When adding new tests:

1. Add unit tests for new utility functions
2. Add integration tests for new client features
3. Add E2E tests for new UI interactions
4. Update this README with new test information
5. Ensure all tests pass before submitting PR
