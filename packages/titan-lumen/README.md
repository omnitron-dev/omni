# @omnitron-dev/titan-lumen

Lumen document services for Titan applications. The module exposes authorized reads, search, theorem graphs and optional durable authoring through the application's existing Netron peer.

## Capabilities

- Document reads and search projected for the admitted caller.
- Symbol contracts and theorem graphs.
- Explicitly authorized playground execution.
- Revision-checked editing backed by the application's database.

## Quick start

```sh
pnpm add @omnitron-dev/titan-lumen
```

```ts
import { LumenModule } from '@omnitron-dev/titan-lumen';

export const documents = LumenModule.forRoot({
  docsDir: '/absolute/docs',
  enablePlayground: false,
});
```

Add the module to an existing Titan application. Resolve `LumenService` and expose it with `peer.exposeService(app.resolve(LumenService))` on that application's Netron peer. The host owns its listeners and authentication provider. `LumenServiceContract` describes the published `Lumen` service; no separate controller or request-supplied session is needed.

An empty corpus returns empty results. A missing configured corpus is an error. Direct in-process reads outside an admitted invocation are anonymous.

## Authorization and editing

Netron supplies the verified invocation identity. `getEditableDocument` and `saveLiveEdit` require `lumen.documents.write`; `executePlayground` independently requires `lumen.playground.execute`. Caller-supplied roles or extra arguments cannot grant those permissions.

Without `liveEdit`, the service reads files and refuses edits. Durable authoring uses `liveEdit: { corpusId, connectionName }`, the existing `TitanDatabaseModule`, and PostgreSQL or file-backed SQLite. Apply `lumenAuthoringMigration` through the application's migration workflow before enabling it. An unavailable store or missing schema is an error, not a fallback to stale files.

`getEditableDocument` returns the original source, revision and hash only when the caller can edit the whole document. Pass that source to Prism's `ResearchEditor.initialSource`, then save snapshot `getSource()` with `baseRevision` and `baseHash`. `saveLiveEdit` reports a conflict when those no longer match. Projected Markdown is for reading or export, not overwriting the original.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Lumen](../lumen/README.md) · [Prism authoring](../prism/README.md#research-documents-and-authoring)

## License

[MIT](../../LICENSE).
