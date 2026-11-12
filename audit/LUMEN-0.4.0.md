# Lumen 0.4.0 independent qualification

Baseline: `3ea505ad` (2026-11-11). This is a verification ledger, not a release certificate. The upstream closure dossier is an input; its completion claims are not accepted without ordinary-entry-point evidence.

## Release boundaries

- Preserve the sealed 0.3.5 publication at `8bdc660e`. Lumen enters 0.4.0 only after qualification.
- Develop visibly on `main` in the primary checkout. Use AGI for qualification snapshots and generated artifacts. Do not replace deployed controllers, owner, applications or Atlas.
- Use Netron for transport/authentication, Titan for lifecycle and DI, Prism for shared UI, Xec for release orchestration, Turbo for the package graph and cache.
- Remove obsolete files, exports and compatibility aliases rather than retaining parallel APIs during this development-stage refactor. `ServiceDescriptor` now belongs only to `netron-protocol`; its old Titan subpath and barrel alias are removed. Server decoration, browser clients and React hooks consume the same typed contract.
- A test must validate useful behavior. A PDF magic header is not evidence of typesetting; a hydration attribute is not evidence of a working interactive component.

## Findings and closure evidence

| ID | Finding | Required closure | State |
| --- | --- | --- | --- |
| L40-01 | Malformed frontmatter can become public; migration uses a second parser; cyclic metadata survives. | One bounded data-only parser, fail-closed metadata, browser compatibility, regression tests. | Closed in source: five baseline failures reproduced; 78 AST and 29 migration tests, typechecks and both package builds pass. YAML/JSON share the browser-compatible bounded parser; plural `tests/` directories now receive the common lint policy. |
| L40-02 | SSG and Titan re-parse raw source with independent access algorithms and incompatible role defaults. | One AST projection, one configurable permission policy, consistent exports and section semantics. | Closed in source: 96 AST, 49 site and 44 Titan-Lumen tests pass, including three reproduced mixed HTML/Markdown leaks and configurable SSG grants. Three builds/typechecks and changed-file lint pass. Roughly 1,000 duplicated lines removed. |
| L40-03 | RPC controller trusts caller-supplied session roles, uses the HTTP auth decorator instead of Netron publication metadata, and retains mutable auth state. | Authoritative invocation context and actual HTTP/WS tests with concurrent identities. | Closed in source: one `LumenService`, authoritative Netron context and one official MCP contract shared by HTTP and stdio (`66dd82cd`). Real official clients exercise negotiation, tools, resources, projection and bounded input. Static stdio uses the spawning process's local trust boundary; it does not accept wire-supplied roles. Final archive qualification remains required. |
| L40-04 | Server JavaScript execution uses node:vm inside a Worker; browser execution uses host JavaScript with an ambient-global denylist. | Capability-free interpreter, resource limits and no host fallback. | Closed in source: six interpreter checks, all 37 Titan-Lumen tests, 43 UI tests and six real Chromium worker checks pass. The compiled module worker runs under CSP without unsafe-eval, rejects host access, excessive aggregate memory/output and endless execution, and has no host/snapshot fallback. Final release archive qualification remains required. |
| L40-05 | PDF is an ASCII-only handwritten PDF writer; it does not compile Typst and truncates long words. | Real typesetter with Unicode, mathematics, layout and independently decoded output checks. | Replaced in source by real offline Typst WASM in a terminable Node worker. Unicode/mathematical geometry, multi-page content, projection, cancellation and injection tests use an independent PDF reader. Missing font glyphs now fail explicitly; 24 packaged-entry-point and multi-page oracle tests pass, including all 200 theorem headers staying with their first content lines. Final release archives remain to be qualified. |
| L40-06 | SSG emits a second island runtime which reports hydration without mounting a component. | Built client assets using the actual lumen-ui runtime; interaction tests against generated output. | Closed in source (`ea697166`): Vite bundles the actual React/Prism runtime. Ten website browser scenarios exercise generated pages, search, execution, themes and three viewport widths. Final clean SDK/site qualification remains required. |
| L40-07 | Pagefind is a handwritten compatibility layer; Mermaid/ELK implementation needs semantic verification. | Use real declared engines or expose accurately scoped alternatives, with representative fixtures. | Real Pagefind indexing/search, configured-index loading and retry are verified. The handwritten diagram parser, SVG geometry and simulated worker pool are removed. Actual Mermaid/ELK runs in the browser through the shared island runtime; SSR retains readable escaped source. Five Chromium scenarios check layout, sequence/class semantics, recovery and directive isolation. Build-time SVG generation is not claimed. |
| L40-08 | Runtime starts with synthetic seed documents; live edits, persistence, missing-directory handling and KB authorization need end-to-end verification. | No synthetic production data or successful fallback; consistent durable state and authorization. | Synthetic data/fallbacks removed; bounded inventories and shared projection govern reads. Durable authoring uses TitanDatabase/Kysera with revision/hash CAS, transactional history and integrity checks (`f3a1c7de`). Actual SQLite and PostgreSQL acceptance pass. Five PostgreSQL scenarios cover independent-connection races, COMMIT failure, canonical transaction retry, migration integrity and database restart (`630a0e05`). |
| L40-09 | SSG writes in place, silently skips invalid output paths, and can retain old files after access changes. | Validated output inventory, recoverable replacement and consistent serving; deletion/restriction and interrupted-build tests. | Closed for local macOS/Linux in `7ef9c7d3`: durable journal, exact file inventory and shared native process identity; 67 tests include real SIGKILL recovery. Serve captures a verified immutable generation. This is recoverable two-rename publication, not a zero-gap atomic exchange; Windows and shared network filesystems are not qualified. |
| L40-10 | Five package READMEs contain only a heading and one sentence. | Complete public APIs, configuration, trust model, practical examples and limitations; publish-install checks. | All five guides now describe actual contracts, CLI/configuration, trust boundaries and limits. Source examples and migration acceptance pass. Final installed-package examples and whole-release archive qualification remain in progress. |
| L40-11 | Docusaurus migration can replace an existing/source directory and verifies parity only after replacement; crawler silently omits failures. | New disjoint destination, complete bounded inventory, pre-publication parity and non-clobbering concurrent behavior. | Closed in source (`6202559e`): complete physical inventory, bounded data-only parsing, mandatory parity before exclusive target claim and exclusive file creation. Existing targets are never replaced. A partial copy remains visible with its exact recovery paths; this is not atomic directory publication. Sixty-six package tests include 36 real CLI cases, plus 58 E2E checks. The report now has one measured routes/anchors contract; phantom link counts and compatibility duplicates are removed. |
| L40-12 | SSR and hydration accept different metadata and can replace malformed props with an empty object. | One bounded lossless JSON contract, local error handling and recovery after metadata changes. | Closed in source (`fa947b57`): one browser-safe codec, 256 KiB and depth 64 limits, strict data-only values, reactive props/triggers and local recovery. Five codec, 52 UI and two real Chromium hydration tests pass. |
| L40-13 | Several configuration fields are accepted without behavior; warning modes skip validation. | Remove unsupported surface or connect it to the real implementation, validate configuration and emit truthful diagnostics. | Closed in source (`e384f4ff`): strict config removes unsupported Titan/PDF switches, KaTeX macros reach actual HTML/Pagefind output, warning modes emit diagnostics and failed custom gates block publication. Mermaid-only documents obtain the default client. Seventy-nine Lumen tests, types and lint pass; final archive/website qualification remains required. |
| L40-14 | Exporters recover missing AST children from raw authoring text, accept unused options, and retain interactive metadata in Markdown. | Require the projected tree, remove inactive API fields/callers, preserve useful content through the shared HTML policy. | Closed in source: all four emitters reject a missing tree; inactive options and their callers are removed. An independent review reproduced an island-marker bypass on prohibited HTML tags; Markdown unwrapping now uses the same allowed container set as HTML sanitization, including nested adversarial checks. All 113 AST tests, both package typechecks and 462 canonical Lumen E2E checks pass at this checkpoint. |
| L40-15 | A custom site layout with React hooks fails when a linked SDK and its consumer load separate React instances. | One SSR module graph for renderer, layout and React peers; actual ordinary-CLI fixture and website build. | Open: reproduced with a real consumer child component using hooks. Client-side deduplication alone does not close the server-rendering defect. |
| L40-16 | Handwritten Markdown emission can turn literal HTML into markup and mishandles fences, nested lists and tables; projected extension containers can retain cached text after child removal. | Standard Markdown serialization with parsed round-trip oracles, and one projection that removes invalidated content caches. | Open: literal `&lt;script&gt;` becomes an active raw tag on Markdown export; a programmatic container's `value` survives removal of its confidential child. Both reproduced independently; the fix must cover the ordinary exporters, not only the fixtures. |

## Installed archive acceptance

The mandatory package-export gate now installs a separate declared Lumen
dependency closure from 15 real tarballs, independently of the installation of
all public workspaces. It checks every nested platform package against the
prepared archive integrity, so a registry copy cannot silently replace a local
candidate. This consumer has no workspace aliases or SDK links.

The checkpoint in `ae4f2e3e` passed npm install/ci and audit (zero known
vulnerabilities), actual Typst PDF/Cyrillic/A4 output, QuickJS execution,
Node-only browser import refusal, three official MCP-client checks and fourteen
Chromium checks. The latter include an ordinary Mermaid-only site build with
its default client, ELK geometry and Pagefind WASM search. These checks run in
the existing release preparation and required CI gate; this checkpoint does
not certify the final 35-package 0.4.0 archives.

Lumen E2E no longer invokes the same whole-workspace export and undeclared-import
scanners a second time. Both remain required root gates; the Lumen-specific
metadata, real CLI and installed-consumer tests remain. The scanner also verifies
type-only imports satisfied by declared DefinitelyTyped packages without letting
runtime imports use that exception. It found and prompted correction of a real
missing Omnitron runtime dependency on `@omnitron-dev/common` (`54942a6d`).

## Comparative evidence

Compare ordinary workflows, extension boundaries, failure behavior, performance and accessibility. No unmeasured speed or superiority claims. Documented competitor capabilities are distinct from measured Lumen behavior.

- Docusaurus: versioning and independent locale builds — https://docusaurus.io/docs/versioning and https://docusaurus.io/docs/i18n/introduction
- Starlight: integrated Pagefind and replaceable search providers — https://starlight.astro.build/guides/site-search/
- Fumadocs: reusable headless UI/layout components — https://www.fumadocs.dev/docs/ui
- Antora: component/version identity across repositories — https://docs.antora.org/antora/latest/distributed-component-version/
- Quarto: real Typst scientific output — https://quarto.org/docs/output-formats/typst.html

Additional primary-source comparison, checked 2026-11-12:

| Reference | Documented capability | Engineering consequence for Lumen |
| --- | --- | --- |
| [VitePress search](https://vitepress.dev/reference/default-theme-search) and [i18n](https://vitepress.dev/guide/i18n) | Local MiniSearch, localized search UI and per-locale configuration; the current docs also describe RTL behavior. | Local search is a baseline capability, not a differentiator. Verify real indexed results, keyboard navigation and source-language content. Locale configuration alone does not establish RTL or multilingual ranking parity. |
| [Rspress introduction](https://www.rspress.rs/guide/start/introduction) and [AI configuration](https://www.rspress.rs/api/config/config-agent) | React documentation tooling includes versions, locales, search and Markdown/llms exports; AI output has explicit configuration. | Producing llms.txt is insufficient evidence of a distinct agent platform. Lumen must prove identical authorization/projection in HTML, Markdown, indexes and MCP, and expose configured capabilities honestly. |
| [Mintlify authentication](https://www.mintlify.com/docs/deploy/authentication-setup) | Full or partial authentication and group-aware methods; the guide calls out old public previews when enabling authentication. | Restricting the next build cannot revoke already distributed copies. Local publication must remove stale public output; operators need an explicit retention/revocation policy for hosted previews, caches and downloaded artifacts. Netron identity must govern every live retrieval path. |
| [MyST cross-references](https://mystmd.org/guide/cross-references) | Structured labels, references and numbering cover documents, equations, figures and tables. | A graph drawn from guessed text is not equivalent. Reference identity and projection must survive HTML and PDF; missing targets must produce diagnostics. Lumen's verified Typst output does not establish full citation, notebook or JATS parity. |
| [Sphinx Intersphinx](https://www.sphinx-doc.org/en/master/usage/extensions/intersphinx.html) | Published symbol inventories resolve references across projects, including configured local inventory files. | Cross-project linking needs explicit inventory identity and offline inputs. Lumen's local corpus graph does not yet prove interoperability with external inventories; do not advertise that as implemented. |
| [Material for MkDocs search](https://squidfunk.github.io/mkdocs-material/setup/setting-up-site-search/) | Client-side multilingual search, optional keyboard suggestions, highlighting and shareable queries. | Evaluate the actual search interaction, not only index generation. Search exclusion is not access control: restricted bytes must be absent from the generated public corpus and index. |

These are documentation-based comparisons, not measurements of competing
implementations. No latency, memory, accessibility or superiority ranking has
been established. Lumen's release acceptance focuses on complete advertised
workflows and failure boundaries rather than adding every competitor feature.
The website migration now preserves 236 prior routes and 2,855 content anchors;
its 10 browser scenarios cover real search, execution and both themes at three
viewport widths. Large-corpus performance budgets, external-inventory linking,
full RTL qualification and broader scientific-output parity remain separately
unqualified; they must not be implied by the 0.4.0 release description.

## Projection acceptance notes

- The original implementation leaked private HTML sections split by Markdown
  paragraphs, headings and inline spans. All three adversarial fixtures failed
  before normalization and pass through the ordinary parser and export paths.
- Restricted headings cover their bodies and nested subsections. The old test
  expecting an internal note inside a confidential section to remain visible was
  corrected to enforce the parent restriction.
- Semantic KB results remain eligible when projection removes nothing. If a
  result was redacted, a hidden-only query match cannot disclose its existence.
- Canonical projections discard `rawContent` and author-only diagnostics. Tests
  verify useful public content in rendered outputs instead of relying on a
  second reconstructed raw-source cache.

## Native service and adapter acceptance

- `LumenService` owns its Netron publication metadata. Direct mutation calls
  without an admitted invocation fail; HTTP and WebSocket share 401/403 behavior.
  A caller cannot supply an author identity, role list or valid-session flag to
  gain authority. The application resolves a single lazy service and its actual
  collaborators through Titan, including asynchronous configuration.
- `LumenMcpAdapter` uses the official MCP SDK for protocol negotiation, tool
  schemas and resource handling. Calls enter native Netron HTTP in process;
  they do not use a second authentication dispatcher or loopback connection.
  Mounted adapters receive the real connection address, independent of spoofed
  forwarding headers. Request bodies and host/origin names are bounded/validated.
- Validation: 35 Titan-Lumen checks; 38 focused Netron HTTP checks; 69 affected
  cross-package scenarios, including real Chromium and child-process CLI probes.
  The latter include 100 concurrent MCP requests and 50 conflicting writes.
  Builds and typechecks cover Titan-Lumen, Netron/Titan and Omnitron consumers.
  Frozen-lockfile installation and changed-package lint pass. The actual
  Titan-Lumen archive contains 35 files, all required public entry points, and
  none of the removed controller, RPC/MCP directories, token aliases or interface
  forwarding files. This is a local packaging check, not npm publication.
- Removed the old F24/F25/F27 and B24/B25 tests of provider counts, synthetic
  default documents, local imitation tools and handwritten diff functions.
  Their useful coverage is exercised through real module lifecycle, HTTP/WS,
  official MCP-client, document-projection and live-edit tests. Test subclasses
  implementing their own role filtering were replaced by actual service calls.
- Durable authoring acceptance now uses an actual TitanDatabase connection and
  declared Kysera migration, not a Map or a test-only store. Four independent
  SQLite connections compete on the same revision/hash; only one succeeds.
  History insertion and deferred COMMIT failures roll back without emitting a
  successful event. Reopening the file preserves content/history, and SQL
  corruption is rejected by hash/byte/revision checks. Source seed changes are
  detected even at revision zero. In-memory SQLite is rejected explicitly.
- The store uses the canonical transaction retry policy. Database failures do
  not fall back to stale source files. Search, document and graph reads consume
  the same persisted corpus with bounded inventory and read admission. Whole
  document authoring permission includes every restricted section.
- Qualification: 64 Titan-Lumen tests, then 19 focused checks after the final
  Unicode guard; eight real module/MCP/concurrent-edit E2E checks, package
  builds/types and lint pass. Five additional PostgreSQL scenarios use the
  ordinary compiled module, eight independent backend connections and a real
  database restart. The isolated database's resources are bounded through the
  canonical Docker test manager; there is no SQLite fallback.
- Static stdio MCP now uses the same official protocol contract through its
  native stdio transport. An official client verifies negotiation, tools,
  resources and access-projected output; oversized frames are rejected before
  accumulation exceeds the configured limit. Seventy Lumen tests and three
  actual HTTP/Netron checks pass. Source/package tests do not replace the final
  clean-release archive acceptance.

## Interpreter acceptance

The shared `/execution` entry uses a fresh QuickJS WASM instance, without host
callbacks or a module loader. Constructor chains remain inside that interpreter.
Server requests enter through Netron permissions and run in terminable Workers;
four workers are admitted per service and excess calls receive 429. Source,
result, stack, time and promise-job limits are explicit. No host fallback exists
in the server path.

An aggregate allocation probe exposed a dependency limitation: setting the
allocator quota to 16 MiB still allowed approximately 1 GiB of arrays. The fix
uses a supplied `WebAssembly.Memory` with equal initial and maximum sizes and
verifies that the engine uses that exact memory. A dedicated regression test
rejects that same finite allocation and then verifies a fresh successful call.
The ordinary server path also rejects dynamic imports, host access, unbounded
loops and oversized output. These are local source/package-boundary checks;
the final published archives and browser worker still require qualification.

## PDF acceptance

The handwritten PDF serializer and its embedded-source tests were removed.
The actual typesetter exposed two further defects which those tests could not
find: references targeted non-referenceable styled text, and unsupported glyphs
were silently rendered as empty squares. Internal references now use typed
Typst label links, and font coverage is checked against the actual bundled or
explicitly supplied font bytes. No filesystem or network font discovery occurs.

A five-page document was rendered with Poppler and visually inspected: Cyrillic,
Greek, a fraction, integrals, a table, code and a theorem crossing pages remain
readable and uncut. PDF.js independently decodes page text and fraction geometry.
Source export stays isomorphic; PDF generation is explicitly a Node-only subpath.
Document compilation does not claim a hard WASM RSS quota: a service operator
must use process/container limits for adversarial multi-tenant workloads.
