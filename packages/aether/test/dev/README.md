# Aether Dev Server Tests

Comprehensive test suite for Aether's development server infrastructure.

## Test Structure

```
test/dev/
├── hmr/
│   ├── engine.spec.ts              # HMR engine unit tests
│   └── fast-refresh.spec.ts        # Fast Refresh unit tests
├── middleware/
│   └── index.spec.ts               # Middleware stack unit tests
├── integration/
│   ├── hmr-workflow.integration.test.ts        # HMR workflow integration tests
│   └── middleware-stack.integration.test.ts    # Middleware integration tests
├── e2e/
│   └── dev-server.e2e.test.ts     # End-to-end dev server tests
└── README.md                       # This file
```

## Test Categories

### Unit Tests

#### HMR Engine Tests (`hmr/engine.spec.ts`)
Comprehensive tests for the Hot Module Replacement engine:

- **Module Graph Operations** (8 tests)
  - Module node creation and tracking
  - Dependency management
  - Module dependency updates
  - Affected module detection
  - HMR boundary detection
  - Module invalidation
  - Circular dependency handling

- **HMR Boundary Detection** (3 tests)
  - Aether component detection
  - Custom boundary configuration
  - File extension-based detection (.tsx, .jsx)

- **Update Propagation** (6 tests)
  - File update handling
  - Full reload triggers
  - Error handling
  - State preservation
  - Update callbacks

- **WebSocket Communication** (7 tests)
  - Connection management
  - Update broadcasting
  - Custom events
  - Update batching
  - Connection lifecycle

- **Configuration** (3 tests)
  - Default configuration
  - Custom configuration
  - Configuration merging

- **Edge Cases** (5 tests)
  - Empty module graph
  - Virtual modules
  - Multiple modules per file
  - Deep dependency chains
  - Concurrent updates

**Total: 32 tests**

#### Fast Refresh Tests (`hmr/fast-refresh.spec.ts`)
Tests for component state preservation during hot updates:

- **Component Registration** (5 tests)
  - Component registration
  - Multiple components per file
  - Cross-file registration
  - Disabled state handling
  - Unique ID generation

- **State Preservation** (8 tests)
  - Signal value preservation
  - Effect subscription preservation
  - Memo computation preservation
  - Disabled preservation
  - Unregistered component handling
  - Error handling
  - Complex nested state

- **State Restoration** (5 tests)
  - Signal restoration
  - Multiple signal restoration
  - Disabled restoration
  - Error handling
  - Missing signal handling

- **Component Signature Comparison** (5 tests)
  - Signature matching
  - Structure comparison
  - Force reset
  - Unknown signature handling
  - Export structure changes

- **Refresh Eligibility Checks** (3 tests)
  - Component detection
  - Non-component detection
  - Multiple exports

- **Component Refresh** (7 tests)
  - File refresh workflow
  - Unregistered file handling
  - Missing component handling
  - Callback triggers
  - Error handling
  - Callback unsubscribe

- **Global Instance** (4 tests)
  - Instance initialization
  - Singleton pattern
  - Instance retrieval
  - Uninitialized state

- **Decorator** (4 tests)
  - Component wrapping
  - Name preservation
  - Uninitialized handling
  - Constructor arguments

- **Statistics** (3 tests)
  - Component counting
  - File counting
  - Stats reset

- **Browser Integration** (1 test)
  - Custom event dispatch

- **Configuration** (3 tests)
  - Default configuration
  - Custom configuration
  - Configuration merging

**Total: 48 tests**

#### Middleware Tests (`middleware/index.spec.ts`)
Tests for the middleware stack and individual middleware:

- **Basic Operations** (4 tests)
  - Stack creation
  - Middleware addition
  - Multiple middleware
  - Stack clearing

- **Request Handling** (6 tests)
  - Request flow
  - Execution order
  - 404 handling
  - Error handling
  - Passthrough
  - Response modification

- **Edge Cases** (3 tests)
  - Empty chain
  - Immediate returns
  - Async operations

- **Logger Middleware** (4 tests)
  - Request logging
  - Duration tracking
  - Error logging
  - Method logging

- **CORS Middleware** (7 tests)
  - Header addition
  - Preflight handling
  - Custom origin
  - Custom methods
  - Exposed headers
  - Credentials
  - Max age

- **Compression Middleware** (5 tests)
  - Gzip compression
  - Small response skipping
  - Already compressed skipping
  - No client support
  - Filter function

- **Static Files Middleware** (3 tests)
  - Non-GET skipping
  - Non-static skipping
  - Extension detection

- **HMR Middleware** (3 tests)
  - WebSocket detection
  - Non-HMR passthrough
  - Endpoint exclusivity

- **Dev Middleware Stack** (8 tests)
  - Complete stack creation
  - CORS disabling
  - Compression disabling
  - Static disabling
  - Middleware order
  - Custom CORS config
  - Custom compression config
  - Minimal config

**Total: 43 tests**

### Integration Tests

#### HMR Workflow Integration (`integration/hmr-workflow.integration.test.ts`)
Tests for complete HMR workflows:

- **Complete HMR Cycle** (5 tests)
  - Full file change workflow
  - Dependency chain propagation
  - Concurrent updates
  - Error handling and recovery
  - Circular dependencies

- **Fast Refresh Integration** (4 tests)
  - State preservation during HMR
  - Component refresh workflow
  - Callback triggers
  - Signature compatibility

- **Module Graph Updates** (3 tests)
  - Dynamic dependency updates
  - Module replacement
  - Module invalidation

- **Error Recovery** (3 tests)
  - Preservation errors
  - Restoration errors
  - Critical error reload

- **Performance** (3 tests)
  - Large module graphs
  - Update batching
  - Throughput

**Total: 18 tests**

#### Middleware Stack Integration (`integration/middleware-stack.integration.test.ts`)
Tests for middleware chain interactions:

- **Complete Request Flow** (4 tests)
  - Multi-middleware flow
  - Short-circuit responses
  - Error handling
  - Async operations

- **Static File Serving Integration** (3 tests)
  - Header application
  - Range requests
  - Conditional requests (ETag)

- **CORS Integration** (2 tests)
  - Preflight + actual request
  - Credentials handling

- **Compression Integration** (2 tests)
  - Threshold-based compression
  - Already compressed skipping

- **Error Handling Integration** (3 tests)
  - Error transformation
  - Async errors
  - Error handler errors

- **Dev Server Middleware Stack** (4 tests)
  - Complete stack
  - HMR upgrade
  - Request logging
  - Concurrent requests

- **Performance and Optimization** (2 tests)
  - High throughput
  - Memory management

**Total: 20 tests**

### E2E Tests

#### Dev Server E2E (`e2e/dev-server.e2e.test.ts`)
End-to-end tests for the complete dev server:

- **Server Lifecycle** (3 tests)
  - Server start
  - Graceful stop
  - Restart

- **HTTP Request Handling** (5 tests)
  - GET requests
  - POST requests
  - CORS preflight
  - Concurrent requests
  - CORS headers

- **WebSocket HMR Connection** (4 tests)
  - Connection establishment
  - Update reception
  - Multiple connections
  - Custom events

- **File Watching and Hot Reload** (4 tests)
  - File change detection
  - Rapid file changes
  - State preservation
  - Full reload trigger

- **Static File Serving** (1 test)
  - Static file serving

- **Error Handling** (2 tests)
  - HMR error handling
  - WebSocket error recovery

- **Performance** (3 tests)
  - Request throughput
  - WebSocket connections
  - HMR update efficiency

**Total: 22 tests**

## Test Coverage Summary

| Category | Files | Tests | Focus |
|----------|-------|-------|-------|
| Unit Tests | 3 | 123 | Individual components |
| Integration Tests | 2 | 38 | Component interactions |
| E2E Tests | 1 | 22 | Complete workflows |
| **Total** | **6** | **183** | **Comprehensive** |

## Running Tests

### All Dev Server Tests
```bash
npm test -- test/dev
```

### Unit Tests Only
```bash
npm test -- test/dev/hmr test/dev/middleware
```

### Integration Tests Only
```bash
npm test -- test/dev/integration
```

### E2E Tests Only
```bash
npm test -- test/dev/e2e
```

### Specific Test File
```bash
npm test -- test/dev/hmr/engine.spec.ts
```

### Watch Mode
```bash
npm test -- test/dev --watch
```

## Known Issues and Notes

### WebSocket in Tests
The HMR engine uses WebSocket for client communication. In test environments where WebSocket is not available (like happy-dom), tests use mock WebSocket objects with the following interface:

```typescript
{
  readyState: number;  // 1 = OPEN, 3 = CLOSED
  send: (data: string) => void;
  close: () => void;
}
```

### Module Graph File Paths
The module graph uses file paths to look up modules. When testing:
- Ensure the `file` parameter in `registerModule()` matches the path used in `handleUpdate()`
- The module's `file` property must match the lookup key in `fileToModulesMap`

### Async Test Operations
Many tests involve async operations (WebSocket messages, update batching). Use appropriate delays:

```typescript
// Wait for WebSocket messages
await new Promise((resolve) => setTimeout(resolve, 20));

// Wait for update batching
await new Promise((resolve) => setTimeout(resolve, 50));
```

### Test Isolation
Each test should:
- Create its own engine/refresh instances
- Clean up connections and state in `afterEach()`
- Mock console methods to prevent test output pollution

### Performance Tests
Performance tests have reasonable thresholds:
- 100 modules: < 1 second
- 100 requests: < 2 seconds
- Update batching: < 500ms

## Test Patterns

### Module Registration Pattern
```typescript
engine.registerModule(
  'module-id',           // Unique ID
  '/src/file.ts',        // File path (must match update path)
  'module',              // Type: 'module' | 'component' | 'asset'
  new Set(['dep-id'])    // Dependencies
);
```

### HMR Boundary Pattern
```typescript
// Mark module as accepting HMR
engine.acceptHMR('module-id', true);  // Self-accepting

// Or mark as boundary
engine.acceptHMR('module-id', false); // Accepts updates
```

### State Preservation Pattern
```typescript
const component = {
  $$signals: {
    count: { get: () => 42, set: vi.fn() }
  }
};

refresh.register(component, '/src/Component.tsx', 'sig-1');
const state = refresh.preserveState(component);

// ... update component ...

refresh.restoreState(component, state);
```

### Middleware Testing Pattern
```typescript
const middleware: Middleware = {
  name: 'test',
  handle: async (req, next) => {
    // Pre-processing
    const response = await next();
    // Post-processing
    return response;
  }
};

stack.use(middleware);
const response = await stack.handle(new Request('http://localhost/test'));
```

## Contributing

When adding new tests:

1. **Choose the Right Category**
   - Unit: Testing individual functions/methods
   - Integration: Testing component interactions
   - E2E: Testing complete workflows

2. **Follow Naming Conventions**
   - Use descriptive test names: `should <action> when <condition>`
   - Group related tests in `describe` blocks
   - Use consistent terminology

3. **Maintain Test Quality**
   - Each test should test one thing
   - Use appropriate assertions
   - Mock external dependencies
   - Clean up after tests

4. **Update Documentation**
   - Add test count to this README
   - Document any special setup
   - Note known issues or limitations

## Debugging Tests

### Verbose Output
```bash
npm test -- test/dev --reporter=verbose
```

### Single Test
```bash
npm test -- test/dev/hmr/engine.spec.ts -t "should create module nodes"
```

### Coverage
```bash
npm test -- test/dev --coverage
```

### Debug Mode
```bash
node --inspect-brk node_modules/.bin/vitest test/dev
```

## References

- [Vitest Documentation](https://vitest.dev/)
- [Aether Dev Server Spec](/specs/frontend/dev-server.md)
- [HMR Protocol Spec](/specs/frontend/hmr-protocol.md)
- [Fast Refresh Spec](/specs/frontend/fast-refresh.md)
