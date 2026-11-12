# @omnitron-dev/lumen-ast

Pure isomorphic prism-doc/2 AST compiler, math environments, KaTeX macro registry, Shiki/Twoslash highlighter, and multi-target emitters for Omnitron Lumen.

## Published math dependencies

The build includes the upstream `micromark-extension-math` syntax tokenizer,
using the same `tsup.noExternal` publication contract as Prism. Its unused HTML
renderer is removed; consumers do not install the extension's separate legacy
KaTeX dependency. Rendering uses this package's direct, patched KaTeX version.
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

Authored HTML is parsed using `hast-util-raw` and rendered with
`hast-util-sanitize`; scripts, event handlers and unsafe URLs are not executable.
Code examples remain literal, including nested fences and directive attributes.

## Executable examples

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
