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
| L40-03 | RPC controller trusts caller-supplied session roles, uses the HTTP auth decorator instead of Netron publication metadata, and retains mutable auth state. | Authoritative invocation context and actual HTTP/WS tests with concurrent identities. | Native backend and HTTP MCP corrected: one `LumenService`, class-based DI and one wire contract. No controller, session arguments, duplicate tokens or handwritten HTTP/SSE MCP transport. Official MCP client works through a real Netron HTTP listener; verified authors and concurrent caller isolation are tested. Browser integration and the separate static-corpus stdio MCP implementation remain under audit. |
| L40-04 | Server JavaScript execution uses node:vm inside a Worker; browser execution uses host JavaScript with an ambient-global denylist. | Capability-free interpreter, resource limits and no host fallback. | Closed in source: six interpreter checks, all 37 Titan-Lumen tests, 43 UI tests and six real Chromium worker checks pass. The compiled module worker runs under CSP without unsafe-eval, rejects host access, excessive aggregate memory/output and endless execution, and has no host/snapshot fallback. Final release archive qualification remains required. |
| L40-05 | PDF is an ASCII-only handwritten PDF writer; it does not compile Typst and truncates long words. | Real typesetter with Unicode, mathematics, layout and independently decoded output checks. | Replaced in source by real offline Typst WASM in a terminable Node worker. Unicode/mathematical geometry, multi-page content, projection, cancellation and injection tests use an independent PDF reader. Missing font glyphs now fail explicitly; packaged-entry-point tests are in progress. |
| L40-06 | SSG emits a second island runtime which reports hydration without mounting a component. | Built client assets using the actual lumen-ui runtime; interaction tests against generated output. | Open |
| L40-07 | Pagefind is a handwritten compatibility layer; Mermaid/ELK implementation needs semantic verification. | Use real declared engines or expose accurately scoped alternatives, with representative fixtures. | Open |
| L40-08 | Runtime starts with synthetic seed documents; live edits, persistence, missing-directory handling and KB authorization need end-to-end verification. | No synthetic production data or successful fallback; consistent durable state and authorization. | Synthetic documents, symbol contracts and theorem-graph fallback removed. Missing configured corpus now fails search/graph reads explicitly. Durable editing, KB/source visibility, scan failure handling and traversal bounds remain open. |
| L40-09 | SSG writes in place, silently skips invalid output paths, and can retain old files after access changes. | Validated output inventory and atomic replacement; deletion/restriction and interrupted-build tests. | Open |
| L40-10 | Five package READMEs contain only a heading and one sentence. | Complete public APIs, configuration, trust model, practical examples and limitations; publish-install checks. | Open |

## Comparative evidence

Compare ordinary workflows, extension boundaries, failure behavior, performance and accessibility. No unmeasured speed or superiority claims. Documented competitor capabilities are distinct from measured Lumen behavior.

- Docusaurus: versioning and independent locale builds — https://docusaurus.io/docs/versioning and https://docusaurus.io/docs/i18n/introduction
- Starlight: integrated Pagefind and replaceable search providers — https://starlight.astro.build/guides/site-search/
- Fumadocs: reusable headless UI/layout components — https://www.fumadocs.dev/docs/ui
- Antora: component/version identity across repositories — https://docs.antora.org/antora/latest/distributed-component-version/
- Quarto: real Typst scientific output — https://quarto.org/docs/output-formats/typst.html

Pending comparison: VitePress, Rspress, Mintlify, MyST, Sphinx and Material for MkDocs; real migration of the Omnitron website; independently measured build/search/browser budgets.

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
- These checks do not certify durable authoring. Edits are still in memory, and the static-corpus
  stdio adapter remains separate. Those release blockers must be closed before
  claiming a production-ready 0.4.0.

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
