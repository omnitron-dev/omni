---
title: "Worker Threads Don't Support execArgv"
severity: critical
tags: [worker-threads, process, tsx, gotcha]
---

## Problem
Worker threads do NOT support `execArgv` — tsx `--import tsx/esm` only works with `child_process.fork()`.
If `options.execArgv` is set and worker threads are used, the TypeScript loader won't be available.

## Fix
ProcessSpawner auto-detects: if `options.execArgv` is set, forces child process mode (not worker threads).

```typescript
// process-spawner.ts
useWorkerThreads = isolation === 'worker'
  && (!options.execArgv || options.execArgv.length === 0);
```

## Also Critical
`handle.supervisor` MUST be set on AppHandle BEFORE `supervisor.start()` —
`attachLogCapture` needs it during the `child:started` event.
