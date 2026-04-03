---
title: "PostgreSQL Bigint String Coercion"
severity: critical
tags: [postgresql, bigint, database, gotcha]
---

## Problem
PostgreSQL `bigint` columns return **strings** in JS via `pg` driver (no `setTypeParser` configured).
`Number.isFinite("5")` returns `false` — strict type check, no coercion.

## Fix
ALL bigint reads from DB MUST use `Number(value)` coercion.

## Affected
- `events.seq`, `memberships.last_read_seq`, `room_sequences.last_seq`
- Aggregate `COUNT()` results
- Any column defined as `bigint`/`int8` in PostgreSQL
