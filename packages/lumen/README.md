# @omnitron-dev/lumen

Lumen builds documentation from Markdown and PDX into a static site, Pagefind search, Markdown mirrors and AI-readable corpus files. It uses Lumen AST for document semantics, Vite for browser assets, and Lumen UI with Prism for interactive components. A static site does not require a Titan server.

## Capabilities

- Documentation builds with route, anchor and corpus checks.
- React layouts and selectively activated islands sharing one frontend dependency graph.
- Local development and preview servers.
- Typst PDF export, document type generation and a read-only MCP server.

## Quick start

In an ESM project, install Lumen and its React peers:

```sh
pnpm add @omnitron-dev/lumen react react-dom
```

Create `lumen.config.ts`:

```ts
import { defineLumenConfig } from '@omnitron-dev/lumen';

export default defineLumenConfig({
  title: 'Project manual',
  url: 'https://docs.example.com',
  srcDir: 'docs',
  outDir: 'dist',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
});
```

Create `docs/index.md`:

```md
---
title: Project manual
slug: /
---

# Project manual

Document the prerequisites and a complete example here.
```

```sh
pnpm exec lumen check --gates linksGate,anchorsGate --strict
pnpm exec lumen build
pnpm exec lumen serve --host 127.0.0.1 --port 4173
```

Initialization is file-based; there is no `lumen init` command. `lumen dev` watches content for local development. Restart it after changing configuration. Both local servers refuse an occupied port rather than selecting another silently.

## Build and publication

The builder validates a staged generation before publishing it. Failed rebuilds retain the last verified generation; the publisher owns output consistency and durability. Serve or deploy the resulting directory through your hosting system. `lumen serve` is a local preview server.

Configuration is trusted executable code. Documents cannot import arbitrary JavaScript or register host components. Static output uses the anonymous audience projection by default; private hosting still needs server-side authorization. `theme.layout` receives projected documents, and its React dependencies are compiled with the renderer in one SSR graph.

Use `lumen pdf --outDir pdf` for PDF files, `lumen types --outDir generated` for corpus types, and `lumen mcp --stdio` for a local read-only corpus server. Keep export directories separate from the static generation. The source directory must exist; a missing corpus is an error.

For development against an unpublished Omni checkout, use the [Omnitron SDK bridge](../../apps/omnitron/README.md#source-sdk-development) with a normally installed full workspace. It builds the declared package graph and preserves the consumer's registry lock baseline; copied package directories are not an SDK installation.

## Documentation

[Configuration and public API](src/index.ts) · [CLI implementation](src/cli) · [Document compiler](../lumen-ast/README.md) · [UI runtime](../lumen-ui/README.md) · [Titan integration](../titan-lumen/README.md)

## License

[MIT](../../LICENSE).
