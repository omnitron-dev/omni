# Cross-Runtime Testing for @omnitron-dev/common

This package implements comprehensive cross-runtime testing for Node.js, Bun, and Deno.

## Architecture

The testing architecture has been redesigned to run **all tests** on **all runtimes**, eliminating duplicate test code and ensuring complete coverage.

### Structure

```
test/
├── runtime/
│   ├── bun-adapter.ts      # Jest API compatibility for Bun
│   ├── bun-all.test.ts     # Runs all *.spec.ts tests in Bun
│   ├── deno-adapter.ts     # Jest API compatibility for Deno
│   ├── deno-all.test.ts    # Runs all *.spec.ts tests in Deno
│   └── test-adapter.ts     # Shared utilities for runtime compatibility
├── *.spec.ts               # Main test files (Jest format)
└── test-utils.ts           # Test utilities
```

### How it Works

1. **Main Tests**: All tests are written in Jest format in `*.spec.ts` files
2. **Adapters**: Runtime-specific adapters provide Jest API compatibility:
   - `bun-adapter.ts`: Maps Jest APIs to Bun test APIs
   - `deno-adapter.ts`: Maps Jest APIs to Deno test APIs
3. **Test Runners**: Runtime-specific test files import and run all specs:
   - `bun-all.test.ts`: Imports adapter and all `*.spec.ts` files
   - `deno-all.test.ts`: Imports adapter and all `*.spec.ts` files

## Running Tests

### Individual Runtimes

```bash
# Node.js (Jest)
npm test

# Bun
bun test test/runtime/bun-all.test.ts

# Deno
deno test --allow-read --allow-write --allow-env --no-check --unstable-sloppy-imports test/runtime/deno-all.test.ts
```

### All Runtimes

```bash
npm run test:all
# or
./scripts/test-all-runtimes.sh
```

## Test Results

Current status (as of last run):
- **Node.js**: ✅ 237/237 tests passing
- **Bun**: ⚠️ 228/234 tests passing (6 timer-related tests fail)
- **Deno**: ⚠️ 2/65 tests passing (issues with expect matchers and event loop)

## Known Issues

### Bun
- `jest.advanceTimersByTime()` is not supported, causing TimedMap tests to fail
- `isPlainObject(globalThis)` returns `true` in Bun vs `false` in Node/Deno

### Deno
- Some expect matchers need polyfilling (e.g., `toStrictEqual`)
- Type conflicts between Node.js and Deno timer types
- Event loop resolution issues with async tests

## Adding New Tests

1. Create your test file as `test/[name].spec.ts` using Jest syntax
2. Import it in both:
   - `test/runtime/bun-all.test.ts`
   - `test/runtime/deno-all.test.ts`
3. Run `npm run test:all` to verify it works on all runtimes

## Future Improvements

1. Better fake timer support for Bun
2. Complete Deno adapter implementation
3. Automated detection and import of `*.spec.ts` files
4. Runtime-specific test skipping for incompatible features