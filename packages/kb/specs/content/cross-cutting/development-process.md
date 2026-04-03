---
module: cross-cutting
title: "Development Process"
tags: [process, testing, debugging, quality, mandatory]
summary: "Mandatory development process: investigate → reproduce → fix → verify"
---

## Mandatory Process

**No hacks. No patching. No quick fixes.** Every bug fix follows this strict process:

### 1. Deep Investigation
- Understand the root cause fully before touching code
- Trace the full call chain
- Read the code, don't guess

### 2. Reproduce with Tests
- Write integration/e2e tests at the appropriate level that reproduce the exact failure
- Unit tests for isolated logic bugs (DI container, resolution, parsing)
- Integration tests for cross-module interactions (service exposure, topology injection)
- E2E tests for user-facing flows (Playwright for portal, curl-level for RPC)

### 3. Fix the Root Cause
- Targeted fix informed by test-driven understanding
- No `@ts-nocheck` in production code — fix types properly
- No log-and-retry debugging loops

### 4. Verify via Tests
- All reproducing tests must pass
- No regressions in existing tests
- Even for "obvious" fixes, write the test first

## Anti-patterns to Avoid
- Touching code before understanding the full call chain
- Skipping test reproduction ("it's obvious")
- Applying fixes without verifying the actual root cause
- Using `any` casts or `@ts-ignore` instead of fixing types

## Code Quality Standards
- Industrial-grade quality — highest standards only
- Code must be of benchmark/reference architecture quality
- Clean, well-structured, minimalist
- Latest package versions always
- `pnpm fix:all` before every commit
