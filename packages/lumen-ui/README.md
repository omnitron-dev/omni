# @omnitron-dev/lumen-ui

Documentation UI blocks, shared-context selective portal hydration runtime, math blocks, and navigation layouts for Omnitron Lumen.

`NetronPlayground` takes one `code` prop. Local runs load the shipped ESM worker and execute in the shared Lumen WASM interpreter. There is no host-window evaluator. Every run has an independent worker, a bounded deadline (1–5000 ms, including startup), and a 64 KiB code/output limit. Worker errors and deadlines are errors; recorded snapshots are labelled separately.

For server execution, pass `mode="server"` and `execute={code => lumenService.executePlayground(code)}`, where `lumenService` is obtained through the application's existing Netron service query. The typed result is `{ code, result, error? }`. Authentication and permission checks remain with Netron. The UI deadline stops waiting for a response; the service enforces its own execution limits.

The production bundler must process the standard `new Worker(new URL(..., import.meta.url), { type: 'module' })` expression and retain the emitted `playground-worker.js` asset. Lumen's Vite build does this. CSP needs `worker-src 'self'` and WebAssembly compilation permission (`script-src 'self' 'wasm-unsafe-eval'`); host JavaScript string evaluation and Blob workers are not required.

Run `test:browser` after building the package and its dependencies. These tests execute the published module and real interpreter in Chromium, including constructor access, host storage/network isolation, memory/output limits, hard worker termination, and recovery after failure. Unit tests cover UI state and worker lifecycle only.
