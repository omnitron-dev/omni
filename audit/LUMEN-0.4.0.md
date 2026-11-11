# Lumen 0.4.0 independent qualification

Baseline: `3ea505ad` (2026-11-11). This is a verification ledger, not a release certificate. The upstream closure dossier is an input; its completion claims are not accepted without ordinary-entry-point evidence.

## Release boundaries

- Preserve the sealed 0.3.5 publication at `8bdc660e`. Lumen enters 0.4.0 only after qualification.
- Develop visibly on `main` in the primary checkout. Use AGI for qualification snapshots and generated artifacts. Do not replace deployed controllers, owner, applications or Atlas.
- Use Netron for transport/authentication, Titan for lifecycle and DI, Prism for shared UI, Xec for release orchestration, Turbo for the package graph and cache.
- A test must validate useful behavior. A PDF magic header is not evidence of typesetting; a hydration attribute is not evidence of a working interactive component.

## Findings and closure evidence

| ID | Finding | Required closure | State |
| --- | --- | --- | --- |
| L40-01 | Malformed frontmatter can become public; migration uses a second parser; cyclic metadata survives. | One bounded data-only parser, fail-closed metadata, browser compatibility, regression tests. | Closed in source: five baseline failures reproduced; 78 AST and 29 migration tests, typechecks and both package builds pass. YAML/JSON share the browser-compatible bounded parser; plural `tests/` directories now receive the common lint policy. |
| L40-02 | SSG and Titan re-parse raw source with independent access algorithms and incompatible role defaults. | One AST projection, one configurable permission policy, consistent exports and section semantics. | Closed in source: 96 AST, 49 site and 44 Titan-Lumen tests pass, including three reproduced mixed HTML/Markdown leaks and configurable SSG grants. Three builds/typechecks and changed-file lint pass. Roughly 1,000 duplicated lines removed. |
| L40-03 | RPC controller trusts caller-supplied session roles, uses the HTTP auth decorator instead of Netron publication metadata, and retains mutable auth state. | Authoritative invocation context and actual HTTP/WS tests with concurrent identities. | Backend fixed: 91 Netron checks and 44 Titan-Lumen checks pass; HTTP/WS use trusted context, mutation grants are distinct. Browser and MCP transport integration still under audit. |
| L40-04 | Server JavaScript execution still uses node:vm inside a Worker; browser execution uses host JavaScript with an ambient-global denylist. | Capability-free interpreter, resource limits and no host fallback. | Open |
| L40-05 | PDF is an ASCII-only handwritten PDF writer; it does not compile Typst and truncates long words. | Real typesetter with Unicode, mathematics, layout and independently decoded output checks. | Open |
| L40-06 | SSG emits a second island runtime which reports hydration without mounting a component. | Built client assets using the actual lumen-ui runtime; interaction tests against generated output. | Open |
| L40-07 | Pagefind is a handwritten compatibility layer; Mermaid/ELK implementation needs semantic verification. | Use real declared engines or expose accurately scoped alternatives, with representative fixtures. | Open |
| L40-08 | Runtime starts with synthetic seed documents; live edits, persistence, missing-directory handling and KB authorization need end-to-end verification. | No synthetic production data or successful fallback; consistent durable state and authorization. | Open |
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
