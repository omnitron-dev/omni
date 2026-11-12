# @omnitron-dev/lumen-ast

The shared document compiler for Lumen. It parses Markdown and PDX into the `prism-doc/2` AST, applies audience access rules and emits HTML, Markdown or Typst source.

## Capabilities

- Data-only frontmatter, document diagnostics, headings, links and mathematical environments.
- KaTeX math, Shiki highlighting and Twoslash queries using the pinned TypeScript compiler.
- Audience projection before rendering, indexing and export.
- Shared island-prop validation, bounded code execution, and separate Node-only PDF and MCP entries.

## Quick start

```sh
pnpm add @omnitron-dev/lumen-ast
```

```ts
import {
  createDocumentAccessPredicate,
  parseDocument,
  projectDocumentAccess,
  toHtmlSsr,
} from '@omnitron-dev/lumen-ast';

const ast = await parseDocument('# Guide\n\nStart here.\n', 'guide.pdx');
const publicDocument = projectDocumentAccess(ast, createDocumentAccessPredicate([]));
if (!publicDocument.allowed) throw new Error('Document is not public');
const html = toHtmlSsr(publicDocument.ast);
```

Use verified identity and explicit role grants for an authenticated audience. Apply the same projection to search, links and exports; hiding a rendered element is not access control. Malformed metadata and unsupported values produce diagnostics or errors instead of a permissive document.

## Public entries

| Entry | Purpose |
| --- | --- |
| Package root | AST, parser, access projection, math, highlighting, diagrams and emitters. |
| `/islands` | Plain-JSON props codec shared by producers and browser islands. |
| `/execution` and `/execution/limits` | Bounded QuickJS execution and its limits. |
| `/diagrams` | Diagram contracts and rendering helpers. |
| `/typst` | Node-only PDF compilation with bundled engine and fonts. |
| `/mcp` | Node-only MCP integration. |

Island props reject cycles, accessors, BigInt and other values JSON cannot preserve. Source, depth and output limits are explicit; rendering a theorem or diagram does not prove its claims.

Twoslash uses actual default libraries from the exact TypeScript dependency. Browser execution reads the embedded library set without filesystem or network access. Ordinary package modules are emitted as native ESM with declarations. Only the math tokenizer is bundled separately, excluding its unused legacy KaTeX renderer; bundled third-party notices are included in `licenses`.

## Editing source

`toCleanMarkdown` is a read/export representation, not a lossless editing format. It can simplify presentation constructs. The authoring path is `LumenService.getEditableDocument` → Prism `ResearchEditor.initialSource` → snapshot `getSource()` → `saveLiveEdit` with the original revision and hash. Do not overwrite the original document with an audience projection.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Lumen](../lumen/README.md) · [Prism authoring](../prism/README.md#research-documents-and-authoring)

## License

[MIT](../../LICENSE). Bundled third-party notices are in [licenses](licenses).
