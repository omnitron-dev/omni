# @omnitron-dev/prism

> Design system constructor — high-level UI building blocks for complex frontends

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/prism
```

## Overview

Prism is a design system built on MUI v7, providing pre-composed, theme-aware components for building production frontends. All reusable UI — layouts, forms, navigation, data display — lives here so that application code stays thin.

### Key Features

- **MUI v7 foundation** — themed components with full customization
- **Layout system** — `DashboardLayout`, navigation items, sidebar, breadcrumbs
- **Form components** — integrated with react-hook-form + zod validation
- **Auth-aware** — components that respect authentication state
- **OTP input** — standalone OTP code input component
- **Avatar system** — default avatars, upload, presigned URL support

## Usage

```tsx
import { PrismProvider, DashboardLayout } from '@omnitron-dev/prism';

function App() {
  return (
    <PrismProvider>
      <DashboardLayout navItems={items}>
        <Outlet />
      </DashboardLayout>
    </PrismProvider>
  );
}
```


## Research documents

`@omnitron-dev/prism/components/research` adds a source-preserving Markdown → typed document → React path. Import `@omnitron-dev/prism/components/research/styles.css` once. It supports GFM, stable Unicode heading anchors, admonitions, tabs, KaTeX and strict Mermaid diagrams. `parseResearchMarkdown(source, documentId)` returns the document tree, heading outline and diagnostics; node attributes retain source positions.

```tsx
import { ResearchDocument, defineResearchWidget } from '@omnitron-dev/prism/components/research';
import '@omnitron-dev/prism/components/research/styles.css';
import { z } from 'zod';

const props = z.object({ value: z.number().finite() }).strict();
const widgets = {
  quantity: defineResearchWidget(1, input => props.parse(input),
    ({ value }) => <output aria-label="Quantity">{value}</output>),
};
<ResearchDocument source={markdown} documentId="paper-overview" widgets={widgets} contents />;
```

Use `$...$` / `$$...$$` for math, a `mermaid` fence for diagrams, and a `prism` fence containing `{"type":"quantity","version":1,"props":{"value":3}}` for a registered widget. `:::note`, `:::warning`, and `:::tabs` with nested `:::tab{label="..."}` use directive syntax. Custom widgets are ordinary host-owned React components with explicit versioned prop validation. The source cannot import JavaScript, register components or grant access. Registries belong to each document, not to process-wide state. `TipTapRenderer` also exposes `nodeRenderers` and `inheritRegisteredNodes`; existing global registrations remain supported by default, while `ResearchDocument` disables inheritance.

Raw HTML and unsupported constructs remain inert with source diagnostics. Unsupported diagram engines retain their source; Pintora is not interpreted as Mermaid. TeX runs with trust disabled and expansion/size limits. Mermaid source cannot change renderer configuration; rendered SVG is sanitized, active content and external references are removed, and theme changes are serialized. Source/AST/block/edge limits bound accepted input, **not execution time**: Mermaid runs on the browser main thread. Host-owned widgets must independently obey the host's accessibility, resource, network and permission policies. This renderer provides presentation, not proof checking or Noesis semantics. The host owns immutable revision identity, digest verification, authorization and publication. Unknown or failing blocks preserve source rather than masquerading as successful verification.

## License

MIT
