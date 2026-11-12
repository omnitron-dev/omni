# @omnitron-dev/lumen

Lumen builds documentation from Markdown and PDX into HTML, Pagefind search,
Markdown mirrors and AI-readable corpus files. It uses `lumen-ast` for document
semantics, Vite for browser assets, and `lumen-ui` with Prism for React islands.
The CLI also checks corpus references, exports PDF through Typst, and exposes a
local read-only MCP server. A static site does not require a Titan server.

## Start a project

Use Node 24 for the qualified development workflow; the package requires Node
22.12 or newer. Keep the Omnitron packages on the same release. For published
packages, install Lumen and its React peers in an ESM project:

```bash
pnpm add @omnitron-dev/lumen react react-dom
```

The source tree currently contains an unpublished 0.4 candidate with staging
package versions. Installing a prior registry version does not provide these
changes. For source development, declare the required packages in the consumer's
`package.json`, install a full Omnitron workspace at a reviewed commit, and use
the canonical SDK bridge from that checkout:

```bash
node ../omni/apps/omnitron/bin/sdk.js init --project-dir .
node ../omni/apps/omnitron/bin/sdk.js dev ../omni --project-dir . --no-watch
```

`sdk init` installs the canonical pnpm hook. `sdk dev` uses the workspace Turbo
graph and a private development lock; it does not fabricate a registry
application lock. A pnpm-generated package-manager metadata document is not a
registry baseline. Qualify registry installation separately after publication.
Use a full workspace checkout with its normal frozen install, not a collection
of copied package directories. SDK selection changes dependencies, not a running
application's release.

Create `lumen.config.ts` at the project root:

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

## First steps {#first-steps}

Write the prerequisites and a complete example here.
```

Project initialization is file-based; there is no `lumen init` subcommand. Add
`"start": "lumen dev"`, `"build": "lumen build"`, and `"serve": "lumen serve"`
to the project's scripts, then run:

```bash
pnpm exec lumen check --gates linksGate,anchorsGate --strict
pnpm run build
pnpm run serve --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/`. Configuration modules, custom layouts, client
entries and gates are trusted project code. Document widgets accept literal
data; documents do not import and execute arbitrary MDX modules.

## Commands and generated files

Commands resolve the project from the current directory or `--root <directory>`.
`--outDir <directory>` overrides the configured output for that invocation.
Both development and preview servers bind to `127.0.0.1:4173` by default and
reject an occupied port.

| Command | Behavior |
| --- | --- |
| `lumen dev` | Builds the site, starts Vite, and rebuilds on changes in existing content, public and `src` directories. Restart after configuration changes. |
| `lumen build` | Checks parse errors and configured gates, builds client assets and Pagefind, and publishes a complete static generation. |
| `lumen serve` | Verifies an existing generation and previews a captured snapshot. Run build first; restart serve to inspect a later build. |
| `lumen check` | Runs all six built-in gates plus configured custom gates. Errors set exit code 1. |
| `lumen pdf --outDir pdf` | Compiles each selected anonymous document with the bundled Typst engine and fonts into `<document-id>.pdf`. |
| `lumen types --outDir generated` | Writes `lumen-corpus.d.ts` with document ID, route and mathematical object ID unions from the anonymous projection. |
| `lumen mcp --stdio` | Serves the local anonymous corpus over stdio until the connection closes. |

Keep `srcDir` present: normal builds materialize output when that directory
exists. `--write` explicitly requests materialization. PDF and type exports need
an explicit `--outDir`; use a separate directory from the static generation.

The static output includes HTML routes, hashed CSS and browser chunks when
needed, public assets, `pagefind/`, Markdown route mirrors, `llms.txt`,
`llms-full.txt`, `asset-manifest.json` and the publisher's generation inventory.
These are deployable files; `lumen serve` is a local preview, not a hosting or
deployment manager.

## Configuration and routes

The loader searches for `lumen.config.ts`, `lumen.config.mjs`, then
`lumen.config.js`. Prefer `.ts` or `.js` in ESM projects. With no configuration it
uses the title `Documentation` and the defaults below. String values support
`${VARIABLE}` expansion from the environment; an unset variable becomes empty.

| Field | Default and effect |
| --- | --- |
| `title`, `tagline` | Project metadata; `title` is required by the public config type. Individual page titles come from document frontmatter. |
| `url` | `http://localhost:3000`; site origin used for canonical URLs. Set it for production. |
| `baseUrl` | `/`; public URL prefix for routes and assets. |
| `srcDir`, `outDir` | `docs`, `dist`; paths relative to the project root. |
| `pagesDir` | Optional additional document directory. Its file paths become routes without the directory prefix. |
| `publicDir` | Optional asset directory copied into the output root; it must exist and contain no symlinks. |
| `trailingSlash` | `false`; chooses `route.html` or `route/index.html`. The root route uses `index.html`. |
| `clientEntry` | Optional trusted browser entry, compiled through Vite. Without it, documents containing islands use Lumen's default entry. |
| `stylesheets` | `[]`; additional stylesheet URLs. Relative URLs refer to public output assets. |
| `theme.defaultMode` | `dark`; initial document theme, also accepts `light`. |
| `theme.layout` | Optional React renderer receiving `{ children, document, documents, config }`. Both document values have already been audience-projected. |
| `sidebars` | `{}`; named arrays of `doc`, `link` and nested `category` items for a custom layout to consume. |
| `locales`, `defaultLocale` | `['en']`, `en`; document locale defaults and corpus metadata. Locales do not automatically create translated pages or URL prefixes. |
| `onBrokenLinks`, `onBrokenAnchors` | `throw`; rejects broken references during build. `warn` checks and reports to stderr, `log` checks and reports to stdout, and `ignore` skips the corresponding build gate. `check` still treats broken references as errors. |
| `gates` | `[]`; additional `CorpusGate` objects run during check and build. |
| `katexMacros` | `{}`; KaTeX string macros used by HTML rendering and Pagefind. Macro dictionaries are scoped to each document render. |
| `pdf.paperSections` | `[]`; `lumen pdf` selects all projected documents, or only matching document IDs/source paths when this list is nonempty. |

`locales` also accepts `{ defaultLocale, locales }`. Category sidebar items use
`{ type: 'category', label, items, collapsed?, href? }`; document items use
`{ type: 'doc', id, label? }`, and links use `{ type: 'link', label, href }`.

Unknown fields and invalid nested values fail configuration loading with the
affected field path. There is no `titan` configuration or `pdf.enabled` switch:
invoke PDF explicitly and integrate live capabilities through the typed
Titan-Lumen/Netron APIs. HTML KaTeX macros do not define PDF macros; the strict
TeX-to-Typst converter rejects unsupported TeX rather than silently dropping it.

Files under `docs` normally retain that prefix: `docs/guide.md` becomes
`/docs/guide`, and `docs/index.md` becomes `/docs`. An absolute frontmatter
`slug` sets an explicit route; a relative slug is resolved beside the source
file. `.md`, `.mdx` and `.pdx` are scanned. Frontmatter `id` overrides the corpus
ID, independently of the route. Duplicate IDs/routes and unsafe routes fail the
build. Heading `{#id}` annotations provide stable fragment targets. Resolved
source links are rewritten consistently in HTML and Markdown mirrors.

## Layouts, islands and live capabilities

The default shell renders document content. A custom navigation layout belongs
in `theme.layout`; a custom browser entry registers its React components with
`LumenShell`. Use `@omnitron-dev/lumen-ui` and the shared Prism provider rather
than a second rendering or theme system. See the
[UI guide](https://github.com/omnitron-dev/omni/blob/main/packages/lumen-ui/README.md)
for the registry, hydration triggers, search adapter and component props.

The CLI compiles the project configuration, layout and existing renderer in one
Vite SSR graph. Ordinary imported components, including React-dependent packages,
share the project's React peers. Layouts are rendered as React components and
can use state and context hooks during SSR. Each build closes its module runner
and removes its temporary compilation files, including after a failure. Temporary
files follow `TMPDIR` on systems that provide it.
Source `import.meta` file paths and ESM resolution stay anchored to the original
module, including when its `resolve` function is extracted into a variable.

Put stylesheet, image and font files in `publicDir`, reference stylesheets with
`stylesheets`, or import browser resources from `clientEntry`. The SSR compiler
rejects imports that emit separate resource files instead of silently omitting
them from the published site. Self-contained inline asset values need no files.

SSR emits readable content and island descriptors. The browser runtime mounts
registered components using the real compiled client bundle. Island props must
be plain JSON data, validated by the shared `lumen-ast/islands` codec. Missing
components and invalid props are errors, not successful hydration. Mermaid
diagrams render with the actual browser engine after hydration; static HTML and
PDF retain readable diagram source. Playground execution uses the isolated
QuickJS worker; static builds do not execute examples.

Pagefind provides local static full-text search. Semantic search, authenticated
reads, authoring and server playground execution require an explicitly supplied
typed service client and a configured Titan-Lumen application. Static output
does not supply these services or enforce per-request authorization.

## Verification and failures

```bash
pnpm exec lumen check --json
pnpm exec lumen check --gates linksGate,anchorsGate --strict
```

`--json` writes only the diagnostics array to stdout. `--gates` filters built-in
gates by their exact names; configured custom gates still run. The built-ins
are `linksGate`, `anchorsGate`, `codeDefaultsGate`, `codeExamplesGate`,
`undocumentedExportsGate` and `mathKernelGate`. They check references, documented
defaults, declared exports, empty code blocks and mathematical dependency
integrity. They do not prove a theorem or execute all documentation examples.
Typecheck and run executable examples in their actual application environment.

Add a gate with `defineCorpusGate({ name, run(context) })`; return
`{ name, passed, diagnostics }`. An error diagnostic includes `code`, `message`
and `severity: 'error'`, with optional source location and suggested fix. Gate
exceptions become `GATE_INTERNAL_ERROR` diagnostics. Build rejects parser and
gate error diagnostics before publication. Vite, Pagefind, asset collision and
filesystem failures also reject the build rather than producing a partial site.

When migrating, compare generated routes and fragment IDs against the previous
site and follow its internal links. A passing corpus check alone does not prove
visual, browser interaction or URL migration parity.

## Audience-specific static builds

`buildStaticSite(corpus, config, { roles, accessFilter })` uses the same
`DocumentAccessOptions` policy as Titan-Lumen. By default the audience is
anonymous. Custom grants propagate to page rendering, search, Markdown mirrors,
`llms.txt` and `llms-full.txt`; these targets never parse access rules separately.
Documents with invalid metadata are omitted rather than partially published.
Static artifacts are public to everyone who can download them, so privileged
builds must be hosted behind the corresponding access boundary.

The [0.4 qualification ledger](https://github.com/omnitron-dev/omni/blob/main/audit/LUMEN-0.4.0.md)
records acceptance evidence and remaining release limits. A successful local
build is not proof of published package or deployment qualification.

## Build output and recovery

`lumen build` stages a complete generation with a byte-count and SHA-256 inventory.
It replaces only output owned by this publisher. For a first build after another
generator, select a new output directory rather than deleting the old result.
On a local filesystem, macOS and Linux publications persist and sync a small
journal before moving the prior output. A later build or serve verifies the
journal, native process birth and boot identity, and every generation file before
recovering an interrupted replacement. It refuses a live publisher, unknown
ownership and symlinks. Publication currently requires these native platform
probes; it does not infer a dead writer from an unverifiable PID.
Windows publication is unsupported until its native process identity probe is
implemented and qualified.

This is recoverable directory replacement, not a zero-gap atomic exchange.
Do not serve the mutable output directory directly while publishing to it.
`lumen serve` verifies and captures one generation with hardlinks, then previews
that snapshot through Vite until shutdown. Restart the preview to inspect a new
build. The publisher always writes fresh files in a new stage and never mutates
a captured generation in place; do not edit generated files manually. This
protocol coordinates one host, not writers
sharing a network filesystem.

## Local MCP access

`lumen mcp --stdio --root <project>` serves the anonymous corpus projection over
the official MCP SDK. The process that launches it owns the local trust boundary;
stdio does not authenticate a remote user and accepts no caller-supplied roles.
Use Titan-Lumen's native Netron-backed adapter for authenticated live access.

Both adapters register the same `search_corpus`, `get_document` and
`lumen_inspect_ast` tools through the isolated `lumen-ast/mcp` entry. Document
arguments and resource URIs use corpus-relative paths, for example
`lumen://corpus/docs/guide.md`. Restricted documents and sections are absent from
static search, resource discovery, reads and AST results. Invalid or missing
corpora fail startup. Configure an MCP client to launch the command with the
project as its working directory. Restart the process after source changes.

Only protocol messages go to stdout; diagnostics go to stderr. The official
stdio transport checks its 1 MiB input buffer limit before appending a chunk,
including an unfinished line, and an over-limit connection releases its input
pipe. Protocol negotiation belongs to the SDK; implementation metadata comes
from the package manifest.
