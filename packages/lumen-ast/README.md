# @omnitron-dev/lumen-ast

The shared document compiler for Lumen. It parses Markdown and PDX into the `prism-doc/2` AST, applies audience access rules and emits HTML, Markdown or Typst source.

## Capabilities

- Data-only frontmatter, document diagnostics, headings, links and mathematical environments.
- KaTeX math, Shiki highlighting and Twoslash queries using the pinned TypeScript compiler.
- Audience projection before rendering, indexing and export; one semantic HTML tree for static output and component rendering.
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
| `/highlight` | Literal-source tokens with dual-theme colors and lazy per-language loading, without the compiler or Twoslash. |
| `/typst` | Node-only PDF compilation with bundled engine and fonts. |
| `/mcp` | Node-only MCP integration. |

Literal code highlighting colors a prefix of complete lines and preserves the full source and its original line endings. The server and browser compute the same prefix. Each 128-column block increases the cost assigned to that line, which bounds the work spent coloring wide generated code. Lines beyond the budget remain readable and selectable.

Island props reject cycles, accessors, BigInt and other values JSON cannot preserve. Source, depth and output limits are explicit; rendering a theorem or diagram does not prove its claims.

Twoslash uses actual default libraries from the exact TypeScript dependency. Browser execution reads the embedded library set without filesystem or network access. Ordinary package modules are emitted as native ESM with declarations. Only the math tokenizer is bundled separately, excluding its unused legacy KaTeX renderer; bundled third-party notices are included in `licenses`.

## Editing source

`toCleanMarkdown` is a read/export representation, not a lossless editing format. It can simplify presentation constructs. The authoring path is `LumenService.getEditableDocument` → Prism `ResearchEditor.initialSource` → snapshot `getSource()` → `saveLiveEdit` with the original revision and hash. Do not overwrite the original document with an audience projection.

Parser positions address the original input, including BOM and frontmatter: offsets are zero-based UTF-16 indices, lines and columns are one-based, and the end is exclusive. Nested JSX, directive attributes and smart references use the same coordinates. `rawContent` contains the body only; slice the original input when applying a node range. Raw HTML normalization may omit positions; consumers must handle their absence. Escaped smart-reference syntax, code, math and link destinations remain literal.

## Document presentation

`toHtmlTree` returns standard HAST after applying the same URL, HTML and plain-JSON props policies used by `toHtmlSsr`. The latter serializes that tree; it does not implement a second document walker. Typed `element.data.lumen` metadata identifies widgets and registered examples for a trusted host renderer. Authored HTML attributes and AST `data` cannot supply this metadata. Code, math and diagram generators produce their own escaped fragments; authored raw HTML always passes through the HTML policy.

Block widgets use `div` hosts; widgets in paragraphs, emphasis, authored inline elements and file-tree annotations use `span`. An inline component must return phrasing content. Registered examples include source disclosures and require a separate block. Static HTML retains the widget fallback and readable source when no component renderer is present.

The `filetree` container directive accepts an optional `title` and one nested unordered Markdown list. Start each item with an inline-code filename, then an optional annotation; a trailing `/` or child list identifies a directory. HTML uses native, initially open disclosures, while Markdown and Typst retain the nested list and annotations. Lumen supplies the shared stylesheet. Prism ResearchEditor preserves the directive as opaque source; the standalone ResearchDocument reader does not interpret it.

Mermaid diagrams retain readable source during SSR and use the real browser engine for layout. Labels support quoted text and Mermaid entity codes such as `#quot;`. Strict rendering permits a fixed set of text-formatting elements without author-supplied attributes, resources or actions; document directives cannot relax that boundary.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Lumen](../lumen/README.md) · [Prism authoring](../prism/README.md#research-documents-and-authoring)

## License

[MIT](../../LICENSE). Bundled third-party notices are in [licenses](licenses).
