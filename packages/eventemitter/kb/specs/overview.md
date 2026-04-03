---
module: eventemitter
title: "Universal Event Emitter"
tags: [events, emitter, async, wildcard, scheduler]
summary: "Async/sync event emitter with wildcard patterns, history tracking, and metrics"
depends_on: [common]
---

## Architecture

Two levels of emitter:
- **Emitter** — Base: sync/async emit, typed events, once listeners
- **EnhancedEmitter** — Adds: wildcard patterns, history, metrics, scheduling

## Key Features

- **Wildcard patterns**: `emitter.on('user.*', handler)` matches `user.created`, `user.deleted`
- **History**: Track and replay past events for late subscribers
- **Metrics**: Event emission counts, listener counts, performance tracking
- **Scheduler**: Parallel or serial event processing with configurable concurrency

## Usage
```typescript
import { Emitter, EnhancedEmitter } from '@omnitron-dev/eventemitter';

// Basic
const emitter = new Emitter<{ 'user:created': [User]; 'user:deleted': [string] }>();
emitter.on('user:created', (user) => { /* typed */ });
await emitter.emit('user:created', newUser);

// Enhanced with wildcard
const enhanced = new EnhancedEmitter();
enhanced.on('order.*', (data) => { /* matches order.created, order.shipped */ });
```

## Used By
Nearly every Titan module depends on this for internal event communication. The ProcessManager, Netron, and all service modules use it extensively.
