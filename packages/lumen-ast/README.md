# @omnitron-dev/lumen-ast

Pure isomorphic prism-doc/2 AST compiler, math environments, KaTeX macro registry, Shiki/Twoslash highlighter, and multi-target emitters for Omnitron Lumen.

## Build and published dependencies

TypeScript emits the AST's ESM modules and declarations in one compiler pass.
Public subpaths share the same modules; the build does not duplicate their state
or roll declarations into hashed chunks. Node and browser consumers use normal
relative module imports.

Only the upstream `micromark-extension-math` syntax tokenizer is bundled, through
one entry without code splitting and the same `tsup.noExternal` publication
contract as Prism. Its unused HTML renderer is removed; consumers do not install
the extension's separate legacy KaTeX dependency. Rendering uses this package's
direct, patched KaTeX version.
The archive gate rejects retained imports of bundled build inputs and installs
and audits the packages with npm, without workspace overrides.

## Frontmatter trust boundary

`parseSafeFrontmatter` is shared by the compiler, Titan integration and migrator. It accepts data-only YAML or JSON, including BOM and CRLF input, and runs in Node and browsers. Unsupported engines, malformed metadata, invalid declared fields, cyclic structures and exceeded limits produce error diagnostics and `access: 'restricted'`. A recovered document body is for authoring diagnostics; it must never be published without authorization.

Limits: 10 MiB per document, 64 KiB frontmatter, 16 metadata nesting levels and 10,000 expanded metadata values. The migrator rejects blocking diagnostics before committing staged output.

## One access projection for every output

Parse once with `parseDocument` (async API) or `parseDocumentSync`, then project
before rendering, indexing or exporting:

```ts
import { parseDocument, createDocumentAccessPredicate, projectDocumentAccess, toHtmlSsr } from '@omnitron-dev/lumen-ast';

const ast = await parseDocument(source, 'guide.pdx');
const audience = createDocumentAccessPredicate(verifiedRoles, { grants: roleGrants });
const projected = projectDocumentAccess(ast, audience);
if (!projected.allowed) return null;
return toHtmlSsr(projected.ast);
```

The default classifications are `public`, `internal` and `confidential`.
Undeclared access is public. Malformed/unknown classifications and documents
with parser error diagnostics are denied, including for administrators. The
shared `@omnitron-dev/access` hierarchy and permission checker implement role
grants; use `DocumentAccessOptions` to supply your application's policy.
Permission names are not accepted as role names. A caller with explicit verified
permissions can pass them as the third argument to `createDocumentAccessPredicate`.

Every declaration restricts access: a public child cannot override a private
parent. A heading governs its complete section until the next heading of equal
or higher level. HTML nesting across Markdown paragraphs and inline text is
resolved with the standard HTML5 parser before authorization. The projected AST
contains neither the original raw document nor authoring diagnostics. It can be
passed to HTML, Markdown, Typst, search and MCP consumers without reimplementing
filtering. Authorized Markdown exports retain document classification metadata.

All emitters require the parsed `children` tree. They never recover content from
`rawContent`: that field belongs to authoring, not to an authorized output.
HTML, Markdown and Typst reject an object without the tree. Markdown
unwraps interactive island containers while retaining their projected document
content, so runtime IDs and serialized widget properties do not leak into exports.
HTML math rendering accepts `macros`; light/dark mode belongs to the page shell
and its shared CSS, including Shiki's dual-theme tokens.

Markdown uses the canonical MDAST serializer with GFM and math extensions. Literal
HTML, code delimiters, nested lists and table cells survive parsing the export
again. An extension container's children are its only body; unknown leaf values
are escaped literal text, not executable HTML or guessed Markdown. This export
does not preserve every authoring construct; use the source-based editing
contract below to edit the original document.

Authored HTML is parsed using `hast-util-raw` and rendered with
`hast-util-sanitize`; scripts, event handlers and unsafe URLs are not executable.
Code examples remain literal, including nested fences and directive attributes.

## Editing the original document

Prism's `ResearchEditor` owns the editor schema and accepts Markdown through
`initialSource`. For durable authoring, obtain that source from the authenticated
Titan-Lumen RPC `getEditableDocument(path)`. It requires
`lumen.documents.write`, configured authoring storage, and access to the entire
document; a caller who can read only a projection cannot obtain an editable
revision. The response contains the original `content`, `revision` and SHA-256
`hash`, including the exact bytes of a revision-zero file seed.

Pass `content` to `ResearchEditor.initialSource`. Its `onChange` callback supplies
a `ResearchSnapshot`; obtain the replacement source with `snapshot.getSource()`
and call `saveLiveEdit` with `docId`, `mode: 'replace'`, `patch`, `baseRevision`
and `baseHash` from the edition being edited. The service checks authorization
again and commits only if both revision and hash still match. A conflict requires
reloading and reconciling the draft, rather than overwriting the newer edition.
An unchanged editor snapshot preserves the original source bytes, including
scientific blocks that the editor retains as source.

`getDocument` and `toCleanMarkdown(projected.ast)` serve reading and export.
Clean Markdown deliberately converts scientific environments to blockquotes
and UI constructs to document text. It may be imported as a new plain Markdown
document, but it is not a lossless editing representation and must not replace
the original source. This package does not define a second editor JSON schema.

## MCP protocol adapter

The explicit Node-only `@omnitron-dev/lumen-ast/mcp` subpath registers Lumen's
read-only tools and resources with the official MCP SDK. It is separate from the
isomorphic root and is not imported into browser workers or page bundles. This
adapter belongs to the document integration boundary; it supplies no transport,
authentication, lifecycle, database or SSG dependency.

`createLumenMcpServer(corpus, identity)` accepts an admitted `LumenMcpCorpus`:
search, document reads and candidate resource paths. The provider owns access
projection. Titan-Lumen supplies request-local native Netron invocations; the
local CLI supplies its anonymous static projection. All tool and resource reads
use that provider, including resource discovery and AST inspection.

## Executable examples

### TypeScript annotations

Twoslash-style `// ^?`, `// @errors: 2322, 2304` and `// @noErrors`
annotations use the actual TypeScript language service. The build embeds the
declared compiler's ES2022 standard-library closure, including DOM declarations,
with the upstream license in `licenses/typescript.txt`. Node and browser consumers
use those same files without filesystem or network lookup. Snippets cannot import
the host workspace or Node modules; this is a standalone virtual TypeScript file,
not an implicit consumer-project typecheck.
The JavaScript compiler dependency is pinned exactly; a runtime compiler/library
version mismatch is rejected before analysis. Native TypeScript used for building
the workspace is a separate tooling dependency.

The caret identifies its exact column on the preceding code line. Missing symbols,
malformed directives and sources above 128 KiB or 2,000 lines fail explicitly;
the analyzer never substitutes another identifier or a synthetic hover. `@noErrors`
hides displayed error annotations, while `actualErrors` and `errorsValid` still
report the measured result. These are admission limits, not a hard CPU quota.
Type analysis does not execute the example.

### JavaScript execution

`@omnitron-dev/lumen-ast/execution` provides `evaluatePlayground(code, timeoutMs)`
for documentation examples. It creates a fresh QuickJS WASM instance with no
host callbacks, filesystem, network, DOM or module loader. Function constructors
remain inside the guest interpreter. Expressions, function-body snippets with
`return`/`await`, JSON results and bounded console output are supported. A promise
that needs an unavailable host capability fails explicitly.

Run this API inside a terminable Worker, as the Lumen browser and Titan adapters
do. Limits are 64 KiB source and output, a fixed 16 MiB WASM heap, 512 KiB guest
stack, 10,000 promise jobs and 1,850 ms execution by default (maximum 5,000 ms).
The WASM memory maximum enforces the aggregate ceiling independently of the
interpreter allocator's quota. The module does not evaluate code in the host or
retry errors through another engine. Import the pure `/execution/limits` subpath
for admission checks without loading the interpreter in the UI thread.

## Offline PDF export

The root entry remains isomorphic. Node applications and the Lumen CLI use the
separate `@omnitron-dev/lumen-ast/typst` entry for PDF generation:

```ts
import { parseDocument, projectDocumentAccess, createDocumentAccessPredicate } from '@omnitron-dev/lumen-ast';
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';

const parsed = await parseDocument(markdown, 'paper.pdx');
const projected = projectDocumentAccess(parsed, createDocumentAccessPredicate(verifiedRoles));
if (!projected.allowed) throw new Error('Document access denied');
const pdf = await compileTypst(projected.ast, {
  paperSize: 'a4', author: 'Research group', lang: 'ru', signal,
});
```

PDFs are typeset by Typst 0.14.2 through the pinned WASM compiler. They contain
embedded fonts, selectable Unicode text, mathematical layout, real pagination,
links and tagged PDF structure. LaTeX mathematics uses a strict `tex2typst`
conversion; unsupported commands and code escapes fail explicitly. `toTypst`
returns the editable markup separately. The PDF does not embed an unfiltered
copy of the source and never substitutes `rawContent` for a redacted AST.

The packaged New Computer Modern and DejaVu Sans Mono fonts cover Latin,
Cyrillic, Greek and mathematics. Missing glyphs are errors, not successful empty
squares. For another script, supply trusted OpenType/TrueType bytes with
`fontData` and select the family with `fonts`; the compiler never discovers
system fonts or downloads fonts/packages. Asset revisions, checksums and their
original licenses are included under `fonts/`.

Compilation runs in a disposable Worker with an in-memory document filesystem
and no Typst package registry. Source is limited to 2 MiB, extra fonts to 16
files/32 MiB, output to 64 MiB and simultaneous jobs to four. `timeoutMs` defaults
to 30 seconds and can be set between 1 and 120,000 ms. Cancellation and timeout
terminate the worker before its slot is released. V8 resource limits do not
constitute a hard RSS quota for the WASM engine; enforce process/container memory
limits when exposing document compilation as a multi-tenant service.

PDF generation is a Node API; it is not imported into the browser's AST bundle.
Interactive widgets export their document content, and Mermaid blocks currently
export their source. The HTML path supplies their interactive visual rendering.


## Mermaid and ELK

`@omnitron-dev/lumen-ast/diagrams` separates document emission from actual
rendering. `renderDiagramHtml(code, index, filePath)` emits an escaped source
and the ordinary `MermaidDiagram` island metadata. SVG rendering takes place
in the browser after hydration.

`renderDiagramSvg(code, id, { theme, colors, signal })` lazily loads the actual
Mermaid engine and requires a browser DOM. Mermaid 12 includes ELK; no second
layout library or server DOM emulation is installed. Syntax, sequence branches,
class members, subgraphs and layout selection belong to that engine. See the
[Mermaid API](https://mermaid.js.org/config/usage) and
[layout documentation](https://mermaid.js.org/config/layouts).

Lumen serializes initialization and rendering together because Mermaid's theme
configuration is shared. Source is capped at 64 KiB, rendered SVG at 4 MiB,
configured edges at 500 and pending renders at 64. Cancellation drops queued or
completed results; it cannot interrupt synchronous browser computation. This is
not a worker sandbox or a hard CPU/RSS quota. Do not expose arbitrary hostile
workloads as a privileged multi-tenant rendering service.

Strict Mermaid security is mandatory. Document directives cannot change the
security level, resource caps, raw theme CSS, host colors or HTML-label policy.
The `MermaidDiagram` UI derives colors from Prism/MUI, displays parse failures,
retains source for inspection and responds to the shell theme. The default
Lumen client registers it automatically. Custom clients must include it in their
island registry. Without JavaScript the source remains readable; PDF/Markdown
exports currently retain diagram source rather than claiming graphical output.


## Island wire data

`@omnitron-dev/lumen-ast/islands` supplies the shared browser-safe
`serializeIslandProps`, `parseIslandProps` and `parseHydrationTrigger` contract.
SSR emission, React hosts and runtime activation use these same functions.
Props must be a plain JSON object, bounded to 256 KiB and 64 nesting levels.
Shared references are copied as a JSON tree; cycles, accessors, custom objects,
BigInt, undefined/functions, non-finite numbers and negative zero are rejected
rather than converted or dropped. Data serialization never executes getters or
`toJSON`. Invalid activation metadata is an error, not an eager-load fallback.
