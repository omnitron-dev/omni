# @omnitron-dev/lumen-ui

React components for Lumen documentation: a shared Prism context, selectively
activated interactive islands, navigation, document blocks, search and sandboxed
code execution. The `@omnitron-dev/lumen` builder bundles this runtime with Vite;
it does not generate a second implementation of these components.

Requires React/React DOM 19. For a complete site, start with the Lumen CLI. Use
this package directly when embedding documentation in an existing React app.

## Public entry points

| Import | Purpose |
| --- | --- |
| `@omnitron-dev/lumen-ui` | All public components, adapters and types, including `ApiExplorer` and `NetronPlayground`. |
| `@omnitron-dev/lumen-ui/runtime` | `LumenShell`, `PortalIslandHost`, `PortalIslandManager`, `useLumen` and activation triggers. |
| `@omnitron-dev/lumen-ui/layout` | `LumenNavbar`, `LumenFooter`, `DocLayout`, `SectionNav` and `DocPagination`. |
| `@omnitron-dev/lumen-ui/blocks` | `MathTheoremBlock`, `HoverReferenceCard`, `CodeBlock`, `BacklinksSection` and `PageAgentActions`. |
| `@omnitron-dev/lumen-ui/search` | `LumenSearchDialog`, `PagefindAdapter`, `NetronAdapter` and their contracts. |

The layout components expose semantic markup and `lumen-*` CSS classes. The
site builder supplies the default stylesheet; an embedding app owns its layout
styles. `LumenShell` supplies Prism by default. Set `disablePrismProvider` when
the host application already owns that provider, to retain its theme and cache.

## One context, selective activation

```tsx
import { useState } from 'react';
import { LumenShell, PortalIslandHost } from '@omnitron-dev/lumen-ui/runtime';

function Counter({ initial = 0 }: { initial?: number }) {
  const [count, setCount] = useState(initial);
  return <button onClick={() => setCount(value => value + 1)}>{count}</button>;
}

export function Documentation() {
  return (
    <LumenShell theme="dark" locale="en" currentPath="/guide" islands={{ Counter }}>
      <PortalIslandHost
        islandId="example-counter"
        component="Counter"
        hydrate="visible"
        props={{ initial: 3 }}
      >
        <span>Counter starts at 3.</span>
      </PortalIslandHost>
    </LumenShell>
  );
}
```

The host renders static fallback content and serialized props. The manager
mounts the registered React component into that element when its trigger fires;
it retains the shell's context. This is portal mounting, not independent React
roots or hydration of arbitrary third-party HTML. Keep one manager per document.
Use unique island IDs and explicit component names. Unknown components retain
their static content until registered; replacing a DOM element creates a new
activation lifecycle, even when it reuses the old ID.

Triggers are `load`, `visible`, `interaction` and `idle` (the default). A custom
`on<Event>` trigger listens for the lowercased event name. `interaction` includes
pointer, touch and keyboard/focus events. `useLumen()` exposes the current theme,
locale and path, `registerIsland(name, component)`, `getIsland(name)`,
`hydrateIsland(idOrComponentName)` and the active island IDs. The registry
contains application code: do not populate it from untrusted document imports.

## Search

```tsx
import { useState } from 'react';
import { LumenSearchDialog } from '@omnitron-dev/lumen-ui/search';

export function Search() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Search documentation</button>
    <LumenSearchDialog
      open={open}
      onClose={() => setOpen(false)}
      pagefindUrl="/pagefind/pagefind.js"
      maxResults={10}
    />
  </>;
}
```

The dialog focuses the input, contains keyboard focus, closes on Escape and
restores the prior focus when removed. Requests are debounced and stale results
are ignored. Service/index failures are visible errors, distinct from a valid
query with no matches. Snippets are rendered as escaped text with supported
highlight marks; result links pass URL validation.

`PagefindAdapter` imports the configured generated Pagefind module, with one
concurrent initialization per adapter. It never substitutes `window.pagefind`
or permanently poisons another adapter after a failure. A subsequent search can
retry failed initialization. `search(query, maxResults)` accepts up to 4 KiB of
UTF-8 text and 0–100 results; empty queries and a zero limit do not load an index.
The module URL is trusted application configuration, not a user-entered URL.
Serve the generated Pagefind JS/WASM/index assets alongside the site, including
the correct base path when hosting under a subdirectory.

For live search, pass `rpcClient` obtained through the application's existing
Netron query. Its structural contract is `search(query, { limit })`, returning
`{ documentId, title, path, snippet, score }[]`. `NetronAdapter` performs only the
UI mapping; it does not open another transport or authenticate independently.
The live-search tab appears only when this client is present. Authorization and
corpus projection remain in `LumenService`, not in a browser role list. Index
exclusion and UI filtering are not access-control boundaries.

## Executable examples

```tsx
import { NetronPlayground } from '@omnitron-dev/lumen-ui';

<NetronPlayground code="return [1, 2, 3].map(value => value * 2)" />;
```

Local runs load the shipped ESM worker and the shared Lumen QuickJS WASM
interpreter. Each run has an independent worker, a bounded deadline (1–5000 ms,
including startup), and a 64 KiB code/output limit. There is no host-window
JavaScript evaluator, network/storage capability or successful fallback after
an execution failure. `snapshot` is optional recorded output, labelled
separately; it never substitutes for execution. `readOnly` prevents editing and
execution, and `onExecute` receives `{ code, result, error?, executionTimeMs }`.

For server execution, pass `mode="server"` and
`execute={code => lumenService.executePlayground(code)}`, where `lumenService`
is obtained through the existing Netron query. The service result is
`{ code, result, error? }`. Netron enforces authentication and permissions.
The UI deadline stops waiting; the server enforces its own execution limits.
A missing server executor is an error, not a switch to local execution.

The production bundler must process
`new Worker(new URL(..., import.meta.url), { type: 'module' })` and retain the
emitted worker asset. Lumen's Vite build does this. CSP needs `worker-src 'self'`
and WebAssembly compilation permission
(`script-src 'self' 'wasm-unsafe-eval'`); host JavaScript string evaluation and
Blob workers are not required.

## Navigation and document blocks

- `DocLayout` accepts document children, sidebar and section-navigation slots.
  `LumenNavbar` accepts links, version/locale choices and callbacks for search,
  theme and selection. The host owns URL changes and persisted preferences.
- `ApiExplorer` displays supplied symbol/method metadata and emits
  `onSelectSymbol`. It is a documentation view; it does not fetch an OpenAPI
  specification or invoke methods based on an endpoint string.
- `MathTheoremBlock` renders an identified mathematical environment and a proof
  terminator. Parsing, numbering, access projection and graph validation belong
  to `lumen-ast` and the builder. The block does not prove a theorem.
- `CodeBlock` renders escaped source. `BacklinksSection` and
  `HoverReferenceCard` display supplied references. `PageAgentActions` links to
  the clean Markdown mirror for the supplied path; that mirror must be produced
  and authorized by the builder/service.

## Verification

Build this package and its dependencies before running `test:browser`.
Production-browser tests execute the bundled module and actual interpreter in
Chromium, including constructor access, host storage/network isolation,
allocation/output limits, worker termination and recovery. Unit tests cover UI
state and lifecycle. The website's separate acceptance covers generated pages,
real Pagefind search, themes and narrow viewports. Passing component tests alone
does not establish accessibility or performance for every consuming application.
