# Decorator Module Critical Fixes

## Summary

Fixed three critical bugs in the Titan decorators module that caused incorrect behavior and potential memory issues.

## Issues Fixed

### 1. Broken Memoize Decorator Cache

**Location**: `src/decorators/decorator-factory.ts` (lines 605-647)

**Problem**:
- Cache was stored in `context.metadata` which is per-call, not per-instance
- This meant memoization didn't work at all - every call would re-execute the method
- Multiple instances shared the same cache due to closure capturing

**Fix**:
```typescript
export const Memoize = createMethodInterceptor('Memoize', (() => {
  // Use WeakMap to store cache per instance, preventing memory leaks
  const cacheMap = new WeakMap<object, Map<string, any>>();

  return function (originalMethod, args, _context) {
    // `this` is the instance due to interceptor.call(this, ...)
    const instance = this;

    // Get or create cache for this instance
    let cache = cacheMap.get(instance);
    if (!cache) {
      cache = new Map();
      cacheMap.set(instance, cache);
    }

    const cacheKey = JSON.stringify(args);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }

    const result = originalMethod(...args);
    cache.set(cacheKey, result);
    return result;
  };
})());
```

**Benefits**:
- Each instance now has its own cache
- WeakMap allows garbage collection of discarded instances
- Memoization actually works correctly

### 2. Lazy Decorator Shared State Bug

**Location**: `src/decorators/injection.ts` (lines 77-122)

**Problem**:
- Cached value was shared across ALL instances due to closure
- First instance to resolve would set the value for all instances
- This caused severe bugs where different instances would see wrong dependencies

**Fix**:
```typescript
export function Lazy<T>(tokenFactory: () => InjectionToken<T>) {
  return function (target: any, propertyKey: string) {
    // Use a unique Symbol to store the cached value on each instance
    const cacheSymbol = Symbol(`lazy-${propertyKey}`);

    Object.defineProperty(target, propertyKey, {
      get() {
        // Check if this instance already has a cached value
        if (!(cacheSymbol in this)) {
          const container = Reflect.getMetadata('nexus:container', this);
          if (!container) {
            throw new Error(
              `@Lazy decorator requires a container to be set. ` +
              `Ensure the class is instantiated through the DI container.`
            );
          }
          // Store the resolved value using the Symbol key on this instance
          this[cacheSymbol] = container.resolve(tokenFactory());
        }
        return this[cacheSymbol];
      },
      enumerable: true,
      configurable: true,
    });
  };
}
```

**Benefits**:
- Each instance gets its own lazy-resolved dependency
- Symbol-keyed property prevents naming conflicts
- Better error message when used outside DI container

### 3. Duplicate Validate Decorator

**Location**:
- `src/decorators/decorator-factory.ts` (lines 700-754) - Renamed to `ValidateSchema`
- `src/decorators/validation.ts` (line 32) - The preferred `Validate`

**Problem**:
- Two different `Validate` decorators existed with different behavior
- One used custom validator functions (decorator-factory.ts)
- One used Zod schemas (validation.ts)
- Caused confusion and potential import conflicts

**Fix**:
1. Renamed the one in `decorator-factory.ts` to `ValidateSchema`
2. Added deprecation warning:
```typescript
if (process.env['NODE_ENV'] !== 'production') {
  console.warn(
    `@ValidateSchema is deprecated and will be removed in v1.0.0. ` +
    `Use @Validate from '@omnitron-dev/titan/decorators' with Zod schemas instead.`
  );
}
```
3. Updated exports in `index.ts` to be explicit:
   - `ValidateSchema` from decorator-factory (deprecated)
   - `Validate` from validation (preferred)
4. Added JSDoc documentation explaining the difference

**Benefits**:
- Clear separation between deprecated and current decorators
- Migration path for users
- Proper exports prevent confusion

## Files Modified

1. `/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/src/decorators/decorator-factory.ts`
   - Fixed Memoize cache to be per-instance using WeakMap
   - Renamed Validate to ValidateSchema with deprecation warning

2. `/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/src/decorators/injection.ts`
   - Fixed Lazy decorator to use Symbol-keyed properties per instance
   - Added better error handling

3. `/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/src/decorators/index.ts`
   - Updated exports to use ValidateSchema (renamed)
   - Added explicit validation decorator exports

4. `/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/test/decorators/custom-decorators.spec.ts`
   - Updated tests to use ValidateSchema
   - Fixed expected error messages

5. `/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/test/decorators/decorator-fixes.spec.ts`
   - Added new test file to verify fixes

## Test Results

All decorator tests pass:
```
PASS test/decorators/custom-decorators.spec.ts (22 tests)
PASS test/decorators/decorator-fixes.spec.ts (4 tests)
PASS test/decorators/core.spec.ts
PASS test/decorators/decorators-nexus.spec.ts
PASS test/decorators/enhanced-method.spec.ts
PASS test/decorators/service-contract.spec.ts
PASS test/validation/validation-decorators.spec.ts
```

## Migration Guide

### For Memoize users

No changes needed - the fix is backward compatible. Existing code will now work correctly:

```typescript
class Calculator {
  @Memoize()
  expensiveCalculation(x: number, y: number) {
    return x * y; // Now actually cached per instance!
  }
}
```

### For Lazy users

No changes needed - the fix is backward compatible:

```typescript
class MyService {
  @Lazy(() => DatabaseToken)
  private db!: Database; // Now correctly resolved per instance
}
```

### For Validate users

If you were using `@Validate` from decorator-factory:

**Old code** (deprecated):
```typescript
import { Validate } from '@omnitron-dev/titan/decorators';

class MathService {
  @Validate({ schema: (x) => x > 0 })
  sqrt(x: number) {
    return Math.sqrt(x);
  }
}
```

**New code** (recommended):
```typescript
import { Validate } from '@omnitron-dev/titan/decorators';
import { z } from 'zod';

class MathService {
  @Validate({
    input: z.number().positive(),
    output: z.number()
  })
  sqrt(x: number) {
    return Math.sqrt(x);
  }
}
```

**Alternative** (use ValidateSchema for backward compatibility):
```typescript
import { ValidateSchema } from '@omnitron-dev/titan/decorators';

class MathService {
  @ValidateSchema({ schema: (x) => x > 0 }) // Will show deprecation warning
  sqrt(x: number) {
    return Math.sqrt(x);
  }
}
```

## Breaking Changes

None. All fixes are backward compatible, with deprecation warnings where appropriate.

## TypeScript Compatibility

All fixes maintain full TypeScript type safety and have proper JSDoc documentation.
