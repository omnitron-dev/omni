# @omnitron-dev/lumen-ui

React components for Lumen documentation: navigation, document blocks, search and interactive islands that share the host's Prism context. Use the Lumen CLI for a complete site, or embed this package in an existing React application.

## Capabilities

- A shared document shell and selective island activation.
- Navigation, mathematical blocks, code examples and reference cards.
- Pagefind and Netron search adapters.
- Mermaid diagrams and host-controlled API or Netron playgrounds.

## Quick start

```sh
pnpm add @omnitron-dev/lumen-ui react react-dom
```

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
        islandId="guide-counter"
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

React and React DOM 19 are required. The Lumen builder supplies default layout styles; embedding applications own their styles. `LumenShell` supplies Prism by default. Set `disablePrismProvider` when the host already owns that provider.

## Runtime boundaries

Islands mount through portals into static hosts, preserving the shell's context. They do not create independent React roots or hydrate arbitrary third-party HTML. Use one manager per document, unique island IDs and host-owned component registrations. Activation supports `load`, `visible`, `interaction` and `idle`.

Props use the shared Lumen AST JSON codec. Invalid metadata reports an error instead of mounting with empty props; unknown components retain their static fallback. Documents cannot register application code or grant network permissions. Live API and Netron playgrounds require explicit host capabilities and server authorization. Mermaid uses strict configuration and sanitized SVG images.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Lumen](../lumen/README.md)

The `/runtime`, `/layout`, `/blocks` and `/search` entries expose their corresponding components without requiring a root import.

## License

[MIT](../../LICENSE).
