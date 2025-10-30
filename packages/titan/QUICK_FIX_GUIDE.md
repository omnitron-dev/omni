# Quick Fix Guide - 376 Test Failures

## TL;DR

**ONE LINE CHANGE fixes 200+ test failures (~53% of all failures)**

## The Problem

```typescript
// ❌ WRONG (current code)
TitanDatabaseModule.forRoot({
  ...context.connection,  // Spreads at wrong level - dialect becomes undefined
  isGlobal: true,
})
```

## The Solution

```typescript
// ✅ CORRECT
TitanDatabaseModule.forRoot({
  connection: context.connection,  // Nest as 'connection' property
  isGlobal: true,
})
```

## How to Fix

### Step 1: Fix the Primary Issue (5 minutes)

```bash
# Edit this file:
# /Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/test/modules/database/docker-integration.spec.ts

# Find line 93-96 and change:
TitanDatabaseModule.forRoot({
  ...context.connection,  # DELETE THIS LINE
  connection: context.connection,  # ADD THIS LINE
  isGlobal: true,
})
```

### Step 2: Verify

```bash
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan
pnpm test
```

**Expected Result:**
- Before: 0 tests passing
- After: 200+ tests passing (~53% success rate)

### Step 3: Fix Remaining Issues (Optional)

See full analysis in `TEST_FAILURE_ANALYSIS.md`

## Top 10 Issues by Impact

| # | Category | Count | Impact | Priority | Fix Time |
|---|----------|-------|--------|----------|----------|
| 1 | Database Config Error | 95 | 200+ tests | CRITICAL | 5 min |
| 2 | Redis Cluster Connection | 14 | 14 tests | HIGH | 60 min |
| 3 | Health Check Timeout | 2 | 2 tests | MEDIUM | 10 min |
| 4 | Redis Connection (DLQ) | 1 | 1 test | LOW | 0 min (already fixed) |
| 5-10 | Other | TBD | TBD | TBD | TBD |

## Error Messages to Look For

After fix, these should disappear:

```
❌ Connection configuration is required for undefined
❌ Failed to connect to database "default": Connection configuration is required for undefined
❌ Database connection default is unavailable
```

## Why This Happened

`context.connection` is type `DatabaseConnection`:
```typescript
{
  dialect: 'postgres',    // ← Gets lost when spreading
  connection: { ... },
  pool: { ... }
}
```

`TitanDatabaseModule.forRoot()` expects `DatabaseModuleOptions`:
```typescript
{
  connection: {           // ← Should be nested here
    dialect: 'postgres',
    connection: { ... },
    pool: { ... }
  },
  isGlobal: true
}
```

Spreading `...context.connection` puts `dialect` at the wrong level, causing it to be `undefined`.

## Verification Checklist

- [ ] Tests show `dialect: 'sqlite'` in logs (not `dialect: undefined`)
- [ ] docker-integration.spec.ts tests pass
- [ ] rotif tests pass (no longer blocked by DB errors)
- [ ] Test success rate increases to ~50%+

## Need Help?

See detailed analysis: `/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/TEST_FAILURE_ANALYSIS.md`
