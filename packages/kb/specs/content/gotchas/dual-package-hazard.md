---
title: "Dual-Package Hazard with Symbol()"
severity: critical
tags: [di, symbol, dual-package, gotcha]
---

## Problem
`Symbol()` creates a unique symbol per module evaluation.
In monorepos, the same package may be evaluated twice (ESM + CJS, or different versions),
producing different symbols that don't match → DI resolution fails silently.

## Fix
All Titan DI tokens and metadata keys use `Symbol.for('titan:...')` instead of `Symbol()`.
`Symbol.for()` returns the same symbol for the same string key, globally.

## Example
```typescript
// WRONG — different symbol per evaluation
const AUTH_TOKEN = Symbol('auth');

// CORRECT — globally unique
const AUTH_TOKEN = Symbol.for('titan:auth:token');
```
