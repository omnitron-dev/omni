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

## Current section navigation

`DocSectionNav` from `/layout` renders native anchor links on the server. Mount it as an island to track the current section of an existing document:

```tsx
<PortalIslandHost islandId="page-toc" component="DocSectionNav" hydrate="load" props={{ headings }}>
  <DocSectionNav headings={headings} />
</PortalIslandHost>
```

Each heading has `{ id, title, level }` and must refer to a real document anchor. The default Lumen client registers this component; custom clients add `DocSectionNav` to their existing `LumenShell` island registry. Style `[aria-current="location"]` or `.is-active` in the host stylesheet.

`DocPagination` from `/layout` renders native previous and next links with the document titles and directional Prism icons. Pass each available neighbour as `{ href, label }`. Set `labels={{ navigation, previous, next }}` to translate the landmark and directions. The links work before hydration and follow the document's reading direction.

The shared Prism scrollspy tracks the last section start above the reading line, including long sections and the final short section at the bottom. CSS `scroll-padding-top` on the scrolling element and `scroll-margin-top` on headings account for fixed headers; an explicit `offset` overrides the reading-line padding. Native links retain keyboard behavior and browser history, with no forced smooth scrolling. An explicit anchor destination near the bottom remains selected until the reader scrolls. Supplying `activeId` instead makes the indicator controlled by the host.

## Live component examples

`ComponentExample` from `@omnitron-dev/lumen-ui/blocks` displays a trusted component and the source used to build it. With Vite, import that module normally for its preview and with `?raw` for its source.

```tsx
import { ComponentExample } from '@omnitron-dev/lumen-ui/blocks';
import Counter from './counter';
import source from './counter.tsx?raw';

<ComponentExample title="Counter" code={source} resettable>
  <Counter />
</ComponentExample>
```

Both the preview and source render on the server. The native source disclosure works with a keyboard and with JavaScript disabled. After hydration, `resettable` lets readers restore the preview's initial state while keeping the source open. Set `language` for a non-TSX module and translate the control labels through `labels.source` and `labels.reset`.

## Runtime boundaries

Islands mount through portals into static hosts, preserving the shell's context. They do not create independent React roots or hydrate arbitrary third-party HTML. Use one manager per document, unique island IDs and host-owned component registrations. Activation supports `load`, `visible`, `interaction` and `idle`.

Props use the shared Lumen AST JSON codec. Invalid metadata reports an error instead of mounting with empty props; unknown components retain their static fallback. Documents cannot register application code or grant network permissions. Live API and Netron playgrounds require explicit host capabilities and server authorization. Mermaid uses strict configuration and sanitized SVG images.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Lumen](../lumen/README.md)

The `/runtime`, `/layout`, `/blocks` and `/search` entries expose their corresponding components without requiring a root import.

## License

[MIT](../../LICENSE).
