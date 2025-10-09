# Error Migration Test Fix Checklist

## Quick Reference
- Total error-related failures: 52
- Module resolution failures: 272 (separate issue)
- Estimated fix time: 2-3 hours for error messages

---

## Category 1: Rate Limit Errors (10 tests)

### File: test/modules/redis/redis.decorators.spec.ts
- [ ] Line ~342: `toThrow('Failed to acquire lock')` → `toThrow(/timed out after/)`
- [ ] Line ~392: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~415: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~449: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~450: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~468: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~473: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~553: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`

### File: test/modules/redis/redis.decorators.real.spec.ts
- [ ] Line ~303: `toThrow('Failed to acquire lock')` → `toThrow(/timed out after/)`
- [ ] Line ~406: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~440: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~507: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`
- [ ] Line ~512: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`

### File: test/modules/redis/redis.integration.spec.ts
- [ ] Line ~885: `toThrow('Rate limit exceeded')` → `toThrow('Too many requests')`

---

## Category 2: Not Found Errors (38 tests)

### Service Not Found Pattern
**Old:** `"Unknown service: X"` or `"Service X not found"`
**New:** `"Service with id X not found"` or use `/Service.*not found/`

### File: test/netron/local-peer.spec.ts
- [ ] Search for: `toThrow(/Unknown service/)`
- [ ] Replace with: `toThrow(/Service.*not found/)`
- [ ] Expected: ~6 replacements

### File: test/netron/remote-peer-edge-cases.spec.ts
- [ ] Search for: `toThrow(/Unknown service|Unknown definition/)`
- [ ] Replace with: `toThrow(/(Service|Definition).*not found/)`
- [ ] Expected: ~4 replacements

### Definition Not Found Pattern
**Old:** `"Unknown definition: X"`
**New:** `"Definition with id X not found"`

### File: test/netron/*.spec.ts (various)
- [ ] Search for: `"Unknown definition"`
- [ ] Replace with: `/Definition.*not found/`
- [ ] Expected: ~6 replacements

### Transport Not Found Pattern
**Old:** `"Transport X not registered"`
**New:** `"Transport with id X not found"`

### File: test/netron/transport-options.spec.ts
- [ ] Search for: `"Transport http not registered"`
- [ ] Replace with: `"Transport with id http not found"` or `/Transport.*not found/`
- [ ] Search for: `"Transport nonexistent not registered"`
- [ ] Replace with: `"Transport with id nonexistent not found"` or `/Transport.*not found/`
- [ ] Expected: ~4 replacements

### File: test/netron/transport/*.spec.ts
- [ ] Search for: `"Transport.*not registered"`
- [ ] Replace with: `/Transport.*not found/`
- [ ] Expected: ~8 replacements

### Redis Client Not Found Pattern
**Old:** `"Redis client with namespace \"X\" not found"`
**New:** `"Redis client with id X not found"`

### File: test/modules/redis/redis.manager.real.spec.ts
- [ ] Search for: `"Redis client with namespace \"non-existent\" not found"`
- [ ] Replace with: `"Redis client with id non-existent not found"` or `/Redis client.*not found/`
- [ ] Expected: ~4 replacements

### Script Not Found Pattern
**Old:** `"Script \"X\" not loaded for client \"Y\""`
**New:** `"Script \"X\" for client with id Y not found"`

### File: test/modules/redis/*.spec.ts
- [ ] Search for: `"Script.*not loaded"`
- [ ] Replace with: `/Script.*not found/`
- [ ] Expected: ~2 replacements

### Policy Not Found Pattern
**Old:** `"Policy 'X' not found"`
**New:** `"Policy with id X not found"`

### File: test/netron/auth/*.spec.ts
- [ ] Search for: `"Policy 'nonExistentPolicy' not found"`
- [ ] Replace with: `"Policy with id nonExistentPolicy not found"` or `/Policy.*not found/`
- [ ] Expected: ~4 replacements

---

## Category 3: Timeout Format Changes (8+ tests)

### Pattern
**Old:** Various formats like `"timeout"`, `"Timeout"`
**New:** `"{operation} timed out after {ms}ms"`

### File: test/netron/*.spec.ts
- [ ] Search for: `toThrow('timeout')` or `toThrow('Timeout')`
- [ ] Replace with: `toThrow(/timed out after \d+ms/)`
- [ ] Expected: ~8 replacements

---

## Module Resolution Issues (Separate Investigation)

### File: test/modules/database/*.spec.ts
**Issue:** `TitanError: Module with id DatabaseTestingService not found`

This requires proper module setup in tests:
```typescript
beforeEach(async () => {
  const module = await createTestingModule({
    imports: [DatabaseModule, DatabaseTestingModule],
    providers: [DatabaseTestingService, AdvancedUserService, ...],
  });
  // ...
});
```

**Files to investigate:**
- [ ] test/modules/database/comprehensive-transaction.spec.ts
- [ ] test/modules/database/comprehensive-repository.spec.ts
- [ ] test/modules/database/comprehensive-migration.spec.ts
- [ ] test/modules/database/database-testing.spec.ts
- [ ] test/modules/database/advanced-features.spec.ts
- [ ] test/modules/database/plugin.spec.ts
- [ ] test/modules/database/real-world-ecommerce.spec.ts
- [ ] test/modules/database/repository.spec.ts

---

## Search & Replace Commands

### Quick Fix Commands (run from packages/titan)

```bash
# Fix rate limit errors
find test -name "*.spec.ts" -type f -exec sed -i '' \
  "s/toThrow('Rate limit exceeded')/toThrow('Too many requests')/g" {} +

# Fix lock timeout errors
find test -name "*.spec.ts" -type f -exec sed -i '' \
  "s/toThrow('Failed to acquire lock')/toThrow(\/timed out after\/)/g" {} +

# Fix service not found (use pattern)
find test -name "*.spec.ts" -type f -exec sed -i '' \
  "s/toThrow(\/Unknown service\/)/toThrow(\/Service.*not found\/)/g" {} +

# Fix definition not found
find test -name "*.spec.ts" -type f -exec sed -i '' \
  "s/toThrow(\/Unknown definition\/)/toThrow(\/Definition.*not found\/)/g" {} +

# Fix transport not found
find test -name "*.spec.ts" -type f -exec sed -i '' \
  "s/not registered/not found/g" {} +
```

**⚠️ Warning:** Review changes before committing. Some replacements may need manual adjustment.

---

## Verification

After making changes, run:

```bash
# Test specific files
npm test -- test/modules/redis/redis.decorators.spec.ts
npm test -- test/netron/local-peer.spec.ts

# Run full suite
npm test

# Expected improvements:
# - Rate limit errors: 10 → 0
# - Lock timeout errors: 2 → 0
# - Not found errors: 38 → 0
# - Total error-related: 52 → 0
```

---

## Progress Tracking

- [ ] Category 1: Rate Limit Errors (10 tests)
- [ ] Category 2: Not Found Errors (38 tests)
- [ ] Category 3: Timeout Format (8 tests)
- [ ] Total: 52 error-related test fixes
- [ ] Verify: Run test suite
- [ ] Document: Update CHANGELOG.md

---

## Notes

1. Use pattern matching (`/regex/`) instead of exact strings for flexibility
2. Some tests may need multiple updates (rate limit + not found)
3. Module resolution issues need separate investigation
4. Consider creating error matcher utilities for future maintainability
