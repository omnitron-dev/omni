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

Set `trailingSlash: true` for directory output (`docs/api/index.html`). Both local servers redirect `/docs/api` to `/docs/api/`, preserving the query and configured `baseUrl`, only when that page exists. Unknown routes remain 404s.

## Build and publication

The builder validates a staged generation before publishing it. Failed rebuilds retain the last verified generation; the publisher owns output consistency and durability. Serve or deploy the resulting directory through your hosting system. `lumen serve` is a local preview server.

Configuration is trusted executable code. Documents cannot import arbitrary JavaScript or register host components. Static output uses the anonymous audience projection by default; private hosting still needs server-side authorization. `theme.layout` receives projected documents, and its React dependencies are compiled with the renderer in one SSR graph.

Every CLI command loads the same project graph, including Vite imports such as `import.meta.glob` and raw source files. Programmatic consumers use `withLumenProject(root, async ({ config, build }) => { ... })`; perform corpus loading, verification and rendering inside that callback. `loadCorpusFromDirectory(root, config)` takes this explicit configuration. The graph is released after the callback settles, including on failure; do not retain its executable configuration or build function for later use.

`renderDocumentHtml` returns a promise and waits for suspended React content before extracting styles. A render error, cancellation or incomplete render fails the build instead of publishing a temporary client fallback. Programmatic `renderDocumentHtml` and `buildStaticSite` callers can pass an `AbortSignal` and `renderTimeoutMs`; the default asynchronous render deadline is 30 seconds per document.

SSR and custom client builds share the consumer's installed React, Emotion, React Hook Form and React Router contexts with linked SDK packages. Install a provider in the website when composing its public API with Prism components. Integrations absent from the website keep their ordinary package resolution.

The static compiler preserves lazy module boundaries. Imported server styles and their relative fonts or images join the same verified output generation as client assets; conflicting bytes at one output path fail the build. CSS resources work below `baseUrl`. JavaScript resource URL imports in the server graph require an inline import or an explicit public URL, because executable configuration determines the base path only after module evaluation.

Critical Emotion CSS retains each cache key, independently owned `Global` block and CSP nonce so the browser can reuse the server styles. Extraction runs once per page and fails on an invalid cache; markup class names alone never mark a style as inserted. Lumen's static baseline has its own style block outside Emotion's ownership.

Use `lumen pdf --outDir pdf` for PDF files, `lumen types --outDir generated` for corpus types, and `lumen mcp --stdio` for a local read-only corpus server. PDF and type exports require `--outDir`. Each export replaces its complete prior generation through the same verified publisher as the site; compilation failure preserves the last valid output. Choose a dedicated directory for each export, outside the static site's directory and its ancestors. Existing directories without Lumen ownership evidence are never replaced.

`srcDir` (default `docs`) must exist and be a directory. An empty source directory is valid, including a site whose content comes only from `pagesDir`; explicitly configured `pagesDir` must also exist. `lumen build` always publishes its output. `lumen types` writes `never` unions for an empty public corpus. `lumen pdf` rejects an empty public selection and unknown `pdf.paperSections` entries, which select document IDs or source paths. Exported PDF names follow document IDs within the output directory; absolute paths and traversal are rejected. Parsing errors fail all exports.

## Server-rendered islands

Export a registry of trusted React components from a module shared by the site configuration and client entry:

```ts
// src/islands.ts
import { Counter } from './counter.js';

export const islands = { Counter };
```

Pass this registry as `islands` to `defineLumenConfig` and to the client `LumenShell`. `<Counter initial={2} hydrate="visible" />` then includes the component's initial HTML in the static page and activates the same component in the browser. Configure `clientEntry` to mount that shell; the registry does not implicitly bundle the server configuration into browser code.

The compiler creates one sanitized HTML tree for both the string serializer and React. Registered components render inside the page's existing React, Prism and Lumen contexts, including lazy components. Names and literal JSON props select registered code; documents never import or evaluate modules. Access projection runs before components execute. Treat component props as document input: validate application-specific values before performing I/O.

Use a block widget on its own line for components containing block elements. Inline widgets use a `span` host and must render phrasing content. A widget absent from the server registry retains its authored static children; provide a useful static representation for browser-only components. The client retains that HTML until its replacement commits. Controls that require JavaScript should expose their pending state until their handlers are active.

## Component examples

Register the source files that the site may publish in its trusted configuration.

```ts
export default defineLumenConfig({
  title: 'Developer guide',
  clientEntry: 'src/client.tsx',
  examples: {
    ComponentPreview: {
      sources: { counter: 'src/examples/counter.tsx' },
      language: 'tsx',
    },
  },
});
```

Use `<ComponentPreview example="counter" title="Counter" hydrate="visible" />` in Markdown and register `ComponentPreview` in the client island registry. The client component loads the preview from the same module.

The build reads registered UTF-8 sources after projecting document access. Paths are relative to the project root, and symlinks must remain inside it. Markdown selects a declared key. Source modules are read as text during static rendering.

The shared `ComponentExample` renders a native source disclosure outside the live island. Its full source supports keyboard scrolling and remains available with JavaScript disabled. The Markdown mirror contains the same source. Set `labels.source` in the group to localize the disclosure.

Document typography stops at island hosts and example frames. Components retain their Prism styling before and after hydration; ordinary headings, links and code remain styled as prose. Custom website prose rules should use the same CSS scope boundary instead of targeting every descendant of `.lumen-doc`.

For development against an unpublished Omni checkout, use the [Omnitron SDK bridge](../../apps/omnitron/README.md#source-sdk-development) with a normally installed full workspace. It builds the declared package graph and preserves the consumer's registry lock baseline; copied package directories are not an SDK installation.

## Documentation

[Configuration and public API](src/index.ts) · [CLI implementation](src/cli) · [Document compiler](../lumen-ast/README.md) · [UI runtime](../lumen-ui/README.md) · [Titan integration](../titan-lumen/README.md)

## License

[MIT](../../LICENSE).
