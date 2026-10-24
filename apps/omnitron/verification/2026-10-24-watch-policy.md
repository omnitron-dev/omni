# Watch policy and cancellation — 2026-10-24

Incident: changing an imported API source restarted a registered bootstrap forecast worker with `watch: false`. The live daemon PID 43859 had been running for approximately 179037 seconds when inspected; its start preceded the app-level esbuild guard introduced in f55c8840f. Updating dist alone does not replace a running daemon's imported code.

The existing guard also left lifecycle gaps in current source:

- A reusable build retained its watcher when a running app was redefined with watch disabled.
- A rebuild callback and the restart coalescer did not distinguish revocable automatic requests from explicit restarts.
- BuildService disposed contexts but not the pending debounce; asynchronous registration or self-heal could outlive cancellation.
- Daemon enable/disable/status controlled/reported only fs.watch, omitting bootstrap projects watched by esbuild.
- FileWatcher config reload retained an existing watch when its settings changed.

## Contract

`watch: false` disables both watcher engines. A successful redefinition or watch-disable RPC has cancelled queued automatic restarts and awaited watcher disposal. An automatic restart already executing cannot be undone. Manual restart remains available and rebuilds current sources when no active watcher maintains the cache. Re-enabling watch must not revive an old queued request. Compilation of TypeScript source in production is independent of watch mode.

One orchestrator policy now governs both automatic restart paths. A watch session owns its contexts, debounce timer, pending creation and self-heal. Diagnostics include registered bootstrap projects. Project reread and ecosystem reload await policy application; neither stops the app simply to change its watch setting.

## Verification

- 176 tests passed across 25 files: the complete orchestrator test directory plus FileWatcher, node watch policy, project reread and namespaced restart tests.
- Real esbuild bundles and real isolated Node children: three apps share one source. Positive-control watched apps rebuild/restart; watch:false preserves PID and artifact bytes; turning a live watch off preserves both; manual restart uses the new source; global disable/re-enable works.
- Controlled races: cancellation during cooldown/in-flight restart, pending debounce, pending registration, scheduled/in-flight self-heal and failure of watch activation.
- Unchanged cancellation test against BuildService from 06ae5a7e fails: callback executes once after unwatch acknowledgement. The fixed implementation passes.
- Production TypeScript build passed with exactOptionalPropertyTypes enabled.

Initial checks exposed stale test doubles still calling the former manual restart entry and an absent path import; these were fixed before the successful run. Build then exposed explicit undefined for an optional watch property; it now removes the property when returning to the default policy.

## Activation

No forecast processes were restarted during these checks. This patch must be loaded by the daemon; a build on disk is not activation. The old daemon cannot disable its esbuild contexts through its exposed disableWatch API. Do not use runtime injection or claim its fs.watch status represents bootstrap watching. Schedule a controlled daemon restart, retain experiment artifacts/state and record any observation gap separately.
