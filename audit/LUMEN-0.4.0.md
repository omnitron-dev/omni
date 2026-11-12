# Lumen 0.4.0 independent qualification

Baseline: `3ea505ad` (2026-11-11). This is a verification ledger, not a release certificate. The upstream closure dossier is an input; its completion claims are not accepted without ordinary-entry-point evidence.

## Release boundaries

- Preserve the sealed 0.3.5 publication at `8bdc660e`. Lumen enters 0.4.0 only after qualification.
- Develop visibly on `main` in the primary checkout. Use AGI for qualification snapshots and generated artifacts. Do not replace deployed controllers, owner, applications or Atlas.
- Use Netron for transport/authentication, Titan for lifecycle and DI, Prism for shared UI, Xec for release orchestration, Turbo for the package graph and cache.
- Remove obsolete files, exports and compatibility aliases rather than retaining parallel APIs during this development-stage refactor. `ServiceDescriptor` now belongs only to `netron-protocol`; its old Titan subpath and barrel alias are removed. Server decoration, browser clients and React hooks consume the same typed contract.
- A test must validate useful behavior. A PDF magic header is not evidence of typesetting; a hydration attribute is not evidence of a working interactive component.

## Findings and closure evidence

The completed archive and website checkpoint below is tied to
`1ede1aea64f3876994e01d424309c070f54ad0be`. It does not certify later changes.
Source-test counts describe their recorded checkpoints; the installed archive
gate exercises public entry points and does not replay every source test.

| ID | Finding | Required closure | State |
| --- | --- | --- | --- |
| L40-01 | Malformed frontmatter can become public; migration uses a second parser; cyclic metadata survives. | One bounded data-only parser, fail-closed metadata, browser compatibility, regression tests. | Closed in source: five baseline failures reproduced; 78 AST and 29 migration tests, typechecks and both package builds pass. YAML/JSON share the browser-compatible bounded parser; plural `tests/` directories now receive the common lint policy. |
| L40-02 | SSG and Titan re-parse raw source with independent access algorithms and incompatible role defaults. | One AST projection, one configurable permission policy, consistent exports and section semantics. | Closed in source: 96 AST, 49 site and 44 Titan-Lumen tests pass, including three reproduced mixed HTML/Markdown leaks and configurable SSG grants. Three builds/typechecks and changed-file lint pass. Roughly 1,000 duplicated lines removed. |
| L40-03 | RPC controller trusts caller-supplied session roles, uses the HTTP auth decorator instead of Netron publication metadata, and retains mutable auth state. | Authoritative invocation context and actual HTTP/WS tests with concurrent identities. | Closed in source: one `LumenService`, authoritative Netron context and one official MCP contract shared by HTTP and stdio (`66dd82cd`). Real official clients exercise negotiation, tools, resources, projection and bounded input. Static stdio uses the spawning process's local trust boundary; it does not accept wire-supplied roles. The official-client archive checks passed for `1ede1aea`. |
| L40-04 | Server JavaScript execution uses node:vm inside a Worker; browser execution uses host JavaScript with an ambient-global denylist. | Capability-free interpreter, resource limits and no host fallback. | Closed in source: six interpreter checks, all 37 Titan-Lumen tests, 43 UI tests and six real Chromium worker checks pass. The compiled module worker runs under CSP without unsafe-eval, rejects host access, excessive aggregate memory/output and endless execution, and has no host/snapshot fallback. Actual interpreter and browser-worker archive checks passed for `1ede1aea`. |
| L40-05 | PDF is an ASCII-only handwritten PDF writer; it does not compile Typst and truncates long words. | Real typesetter with Unicode, mathematics, layout and independently decoded output checks. | Replaced in source by real offline Typst WASM in a terminable Node worker. Unicode/mathematical geometry, multi-page content, projection, cancellation and injection tests use an independent PDF reader. Missing font glyphs now fail explicitly; 24 packaged-entry-point and multi-page oracle tests pass, including all 200 theorem headers staying with their first content lines. Actual PDF output from the installed archives passed for `1ede1aea`. |
| L40-06 | SSG emits a second island runtime which reports hydration without mounting a component. | Built client assets using the actual lumen-ui runtime; interaction tests against generated output. | Closed in source (`ea697166`): Vite bundles the actual React/Prism runtime. Twelve website browser scenarios on SDK `1ede1aea` exercise generated pages, search, execution, types, formulas, diagrams, themes and three viewport widths. The same candidate passed its installed-consumer browser gate. |
| L40-07 | Pagefind is a handwritten compatibility layer; Mermaid/ELK implementation needs semantic verification. | Use real declared engines or expose accurately scoped alternatives, with representative fixtures. | Real Pagefind indexing/search, configured-index loading and retry are verified. The handwritten diagram parser, SVG geometry and simulated worker pool are removed. Actual Mermaid/ELK runs in the browser through the shared island runtime; SSR retains readable escaped source. Five Chromium scenarios check layout, sequence/class semantics, recovery and directive isolation. Build-time SVG generation is not claimed. |
| L40-08 | Runtime starts with synthetic seed documents; live edits, persistence, missing-directory handling and KB authorization need end-to-end verification. | No synthetic production data or successful fallback; consistent durable state and authorization. | Synthetic data/fallbacks removed; bounded inventories and shared projection govern reads. Durable authoring uses TitanDatabase/Kysera with revision/hash CAS, transactional history and integrity checks (`f3a1c7de`). Actual SQLite and PostgreSQL acceptance pass. Five PostgreSQL scenarios cover independent-connection races, COMMIT failure, canonical transaction retry, migration integrity and database restart (`630a0e05`). |
| L40-09 | SSG writes in place, silently skips invalid output paths, and can retain old files after access changes. | Validated output inventory, recoverable replacement and consistent serving; deletion/restriction and interrupted-build tests. | Closed for local macOS/Linux in `7ef9c7d3`: durable journal, exact file inventory and shared native process identity; 67 tests include real SIGKILL recovery. Serve captures a verified immutable generation. This is recoverable two-rename publication, not a zero-gap atomic exchange; Windows and shared network filesystems are not qualified. |
| L40-10 | Five package READMEs contain only a heading and one sentence. | Complete public APIs, configuration, trust model, practical examples and limitations; publish-install checks. | All five guides now describe actual contracts, CLI/configuration, trust boundaries and limits. Source examples and migration acceptance pass. Installed public-entry-point examples and the complete 35-package archive gate passed for `1ede1aea`; this is not npm publication or a claim that every prose example has been executed. |
| L40-11 | Docusaurus migration can replace an existing/source directory and verifies parity only after replacement; crawler silently omits failures. | New disjoint destination, complete bounded inventory, pre-publication parity and non-clobbering concurrent behavior. | Closed in source (`6202559e`): complete physical inventory, bounded data-only parsing, mandatory parity before exclusive target claim and exclusive file creation. Existing targets are never replaced. A partial copy remains visible with its exact recovery paths; this is not atomic directory publication. Sixty-six package tests include 36 real CLI cases, plus 58 E2E checks. The report now has one measured routes/anchors contract; phantom link counts and compatibility duplicates are removed. |
| L40-12 | SSR and hydration accept different metadata and can replace malformed props with an empty object. | One bounded lossless JSON contract, local error handling and recovery after metadata changes. | Closed in source (`fa947b57`): one browser-safe codec, 256 KiB and depth 64 limits, strict data-only values, reactive props/triggers and local recovery. Five codec, 52 UI and two real Chromium hydration tests pass. |
| L40-13 | Several configuration fields are accepted without behavior; warning modes skip validation. | Remove unsupported surface or connect it to the real implementation, validate configuration and emit truthful diagnostics. | Closed in source (`e384f4ff`): strict config removes unsupported Titan/PDF switches, KaTeX macros reach actual HTML/Pagefind output, warning modes emit diagnostics and failed custom gates block publication. Mermaid-only documents obtain the default client. Seventy-nine Lumen tests, types and lint pass; the `1ede1aea` archive and website gates passed. |
| L40-14 | Exporters recover missing AST children from raw authoring text, accept unused options, and retain interactive metadata in Markdown. | Require the projected tree, remove inactive API fields/callers, preserve useful content through the shared HTML policy. | Closed in source: HTML, Markdown and Typst require a projected tree; the separate TipTap format is removed (L40-17). Inactive options and their callers are removed. An independent review reproduced an island-marker bypass on prohibited HTML tags; Markdown unwrapping uses the same allowed container set as HTML sanitization, including nested adversarial checks. The initial checkpoint passed 113 AST tests, both package typechecks and 462 canonical Lumen E2E checks; subsequent combined verification is recorded below. |
| L40-15 | A custom site layout with React hooks fails when a linked SDK and its consumer load separate React instances. | One SSR module graph for renderer, layout and React peers; actual ordinary-CLI fixture and website build. | Closed in source (`9939d9a0`, `5974457b`): a production Vite SSR graph compiles the renderer, layout and React peers together. Native CLI acceptance covers separate consumer React, ESM/CJS children, source metadata and conditional import resolution. Unsupported emitted resources fail explicitly; inline resources are verified in actual HTML. Eighty-four package checks, types and lint pass; the native fixture is part of archive acceptance (`55b2b79e`) and passed for `1ede1aea`, as did the reference website. |
| L40-16 | Handwritten Markdown emission can turn literal HTML into markup and mishandles fences, nested lists and tables; projected extension containers can retain cached text after child removal. | Standard Markdown serialization with parsed round-trip oracles, and one projection that removes invalidated content caches. | Closed in source (`293c73b2`, `2a2e527a`): the shared projection removes invalidated container caches; canonical MDAST/GFM/math serialization replaces manual Markdown concatenation. Nineteen ordinary-parser round-trip scenarios cover literal HTML, code delimiters, nested lists, tables, references, metadata and URL handling. Forty-one focused projection/serialization checks pass. The complete `1ede1aea` archive gate passed. |
| L40-17 | The unused TipTap exporter invents nodes that the actual Prism ResearchEditor schema does not accept and loses nested content. | Remove the parallel format and test the real authorized source-editing path. | Closed in source (`c8cada65`): exporter, types and fake callers removed. Native Netron/SQLite/Prism acceptance checks full-source permission, original CRLF bytes/hash, nested marks, ordered-list start, block table cells, untouched scientific source and successful/stale CAS writes. Clean Markdown is explicitly a read/export format, not a lossless editing format. |
| L40-18 | Twoslash uses handwritten partial TypeScript declarations, guesses another symbol when the query fails and marks oversized or hidden-error snippets as successful. | Use the actual compiler's standard libraries, exact query positions, bounded inputs and truthful results in Node/browser archives. | Closed in source: the build embeds 63 official ES2022/DOM library files (2.83 MiB); the runtime host admits only those files and the snippet. Forty-four focused checks, the actual package build and offline Chromium/CSP acceptance pass. The compiler is pinned directly (`06201c44`); a runtime/compiler mismatch is rejected before analysis. Actual Node/browser archive checks and reference-site annotations passed for `1ede1aea`. |
| L40-19 | The first 0.4.0 npm consumer installation rejects Titan Mailer's two internal peer ranges, which still require 0.3.x. | Derive internal dependencies from the same workspace release and reject stale ranges before building or packing. | Closed in source: both peers use `workspace:*`; actual packing produces exact 0.4.0 peers and preserves the optional notifications peer. The existing dependency scanner and archive gate share one workspace-reference check, also run as the first release-build step. Five focused checks and the full scanner pass; the generated lockfile passes frozen validation. The complete clean 35-package archive installation passed for `1ede1aea`. |
| L40-20 | The final website build passes static parity but its browser API/diagram imports fail with `__vite_ssr_import_meta__ is not defined`. | Preserve the native Node compiler boundary when executing the SSR bundle, and exercise its subsequent client build through the ordinary CLI in a browser. | Closed in source (`c706a90f`, `39ff2e55`): the scoped Vite environment treats the exact resolved Node compiler URLs as native modules. Vite's preload generator therefore receives its original function rather than an SSR-transformed function. The existing disposable SSR graph and its cleanup remain intact. The same ordinary CLI/Chromium regression fails on the old SDK and passes on the fix: custom layout hooks, lazy API chunk, CSS preload, filtering and Mermaid/ELK, with no page/network errors. All 84 package checks, types and lint pass. The `1ede1aea` archive gate includes this regression; its reference website also passes all twelve browser scenarios. |
| L40-21 | A dynamically registered classic website starts successfully but is absent from the execution owner's watch inventory; `sdk dev --stack` therefore skips it. | Canonical owner inventory and SDK refresh must cover registered local applications, with two successful SDK rebuild/restart cycles and a failed build preserving the last ready generation. | Closed in source and isolated native website acceptance. Source fixes unify owner subscriptions, fence automatic refresh with `sourceRefresh@1` and exact generation/definition receipts, and distinguish successful builds from per-application readiness. SDK checkpoint checks pass 55 cases (`1dea91d0`); the mutable-entry retarget regression and related suites pass 68 (`a79dd63c`). A clean `b5a083e6` runtime serves both successful SDK revisions through new application PIDs while the owner stays unchanged; ten samples after a compiler failure preserve the second revision's PID, generation, checkpoint bytes and HTTP content. Old-backend/current-owner source-watch compatibility and final release qualification remain separate gates. |
| L40-22 | `lumen dev` writes Vite's `.vite/deps` cache into the published generation; the next ordinary build rejects its inventory and the managed site cannot restart. | Keep dev-server state outside the published generation, with lifecycle cleanup and actual edit/restart acceptance. | Closed in source (`bd6bfc6c`) and isolated native acceptance. Eighty-five package checks, types and lint pass, including an ordinary CLI dev process with successful edits, a rejected build preserving the previous HTTP response, shutdown/cache cleanup and restart. The clean `b5a083e6` managed website completes both automatic SDK refreshes. The original failure preserves exactly two extra cache files, with no changed or missing declared output. |
| L40-23 | A compiled system health worker inherits bare `tsx/esm` from the backend and cannot resolve it from the ecosystem directory; the daemon repeatedly falls back to direct checks. | Choose loading from the actual worker entry and installed package, and verify the dedicated child through real PM execution outside a dependency directory. | Closed in source (`b5a083e6`) and isolated native acceptance. The existing SystemWorkerManager owns child isolation and loader selection; compiled JS needs no preload and source TS uses the installed loader URL. Fifty-five focused checks, source/test types and lint pass. A real subprocess executes both compiled JS and a TS enum through PM from a cwd where `tsx/esm` cannot resolve. The frozen native health worker initializes through PM and reports no startup failure throughout both website refreshes and failed-build preservation. |

## Combined source verification

Snapshot `9939d9a0` passed all 145 AST tests after an ordinary frozen offline
dependency installation. The canonical Lumen E2E run passed 460 of 461 checks;
its only failure was an obsolete expectation that malformed Twoslash `@errors`
metadata would render successfully. The runtime correctly rejected it. The
test-only correction in `c8972d7c` passes all five checks in that file; no runtime
behavior was weakened. Other package builds in this source-verification checkout
were retained, so these results do not replace clean release qualification.

The first 0.4.0 preparation stopped during the installed-consumer stage at
L40-19. It created neither sealed release archives nor a release tag. Release
preparation must succeed from the corrected commit before publication.

The next preparation (`5b97692e`) passed its installed-consumer checks, including
the separate Lumen consumer, but the reference website exposed L40-20. The
ordinary clean-tree guard then refused to seal that superseded candidate. The
new CLI-to-browser regression is now part of the mandatory archive gate.

CI for `5b97692e` confirmed backend/Console reproducibility and exposed four
additional verification failures. Shadowed local variables were renamed
(`8fe77082`); the migration test now checks the actual structured parity report
(`c0c9bb07`); test inventory asks the real Playwright runner to list configured
and directly scripted tests (`63339380`, nine regression checks, no orphaned
files or collection failures); the release fixture declares its actual Compiler
API dependency (`e2f1b5f8`). Seven real Xec/loopback-registry checks verify both
preflight refusal before building/tagging/sealing and subsequent publication,
interruption, resumption and integrity rejection. These local fixes require a
new exact-commit CI run.

CI at `883922a2` still reported two migration-package lint failures: a unary
expression switch lacked a default branch and a directory reader shadowed its
parameter. `e0b9eefc` fixes both without accepting unsupported expressions. An
isolated frozen offline installation passed package lint, all 67 migration
tests, typecheck and direct accepted/rejected unary-expression probes. This
scoped result does not stand in for a later whole-workspace CI run.

The later L40-21 core watcher/RPC checkpoint (`c13f21eb`) passes 126 checks in twelve files
on an isolated SDK copy. Production and test typechecks and application-wide
ESLint pass. Classic lifecycle checks use actual child forks, SQLite owner state
and HTTP responses; only filesystem event delivery is controlled through the
existing native watcher seam. They verify a retained subscription and a trailing
edit while a replacement child waits for readiness, including after an earlier
definition change. Native subscription errors and partial registration failures
remove the reported watch inventory. These source results do not establish
the complete website's managed SDK refresh, a release build or remote CI.

The following owner-receipt correction (`b5ced073`) passes 239 checks across
31 files, including the complete orchestrator directory, authenticated Netron
HTTP, private Unix transport and FileWatcher checks. Source/test typechecks and
application lint pass. The owner returns the exact admitted process/source
receipt; later controller inventory cannot replace it. Canonical-name mismatch,
revoked requests and unchanged generations do not produce a successful receipt.
The separate native website replay below verifies the ordinary managed path.

The SDK checkpoint fix (`1dea91d0`) passes 55 checks and records the successful
build separately from each application's exact owner receipt. A build-only run
or a different stack cannot certify application refresh. Pending/failed startup,
missing subscriptions and changed bindings fail explicitly. The subsequent
native watcher fix (`a79dd63c`) captures the configuration that created each
subscription, rather than comparing two references to a caller-mutated object.
Its new classic fixture proves same-object cwd A-to-B redefinition closes A,
ignores later A events and produces a new child PID and HTTP value after a B
event. The related 68 checks, full application source/test types and lint pass.

A normal clean `a79dd63c` Xec/Turbo build completed 36 build and 13 build:titan
tasks. The backend and Console stamps both identify that clean commit. Its
separately frozen 301-package runtime has digest
`3ae02e9e3484ba5dd3b82cb7ffc83de668e33ea06f5b762e24611ae8e83e9fe6`.
The existing managed-backend scenario used a private home/socket, separate
loopback ports and its own PostgreSQL container/network (512 MiB, one CPU,
128 PIDs). Actual website HTTP returned 38,185 bytes with the custom SSR layout
and a unique fixture nonce. Watch inventory passed the earlier refusal; the
first owner-managed SDK refresh then failed on L40-22. SDK readiness was not
reported as successful. Backend logs independently exposed L40-23, so the run
does not qualify a healthy native runtime.

The failed run's native jobs, owner/backend/site processes and Docker resources
were cleaned up, and the fixture's site/source edits were restored. Its output,
logs and exact inventory difference remain at
`/Volumes/AGI-Dev/work/omnitron/omnitron-handoff-website-4QG73j`;
`failure-evidence.json` records the two extra `.vite/deps` files and verified
cleanup. Build/source logs are `source-refresh-native-build.log`,
`watch-retarget-{red,green}.log` and `health-loader-{red,green}.log` under
`/Volumes/AGI-Dev/work/omnitron`. These are local source/native failure evidence,
not release qualification, rollback compatibility or remote CI acceptance.

After the Lumen cache and worker-loader fixes, a second ordinary clean Xec/Turbo
build freezes `b5a083e6505c7bcd84ce6793b468e842c27d8d6f` into a 301-package
runtime with SHA-256
`cc3e1eb39d6071f68574e9fe66391c9a7a798ee3464a4cb5e0388fa05b1627e2`.
The repeated private managed website scenario passes through the shipped SDK
CLI, owner receipt and actual SSR HTTP response. The owner PID stays 88186;
the ready website PID changes from 1097 to 7380 and then 12299 for two real
SDK source revisions. HTTP content changes from 38,185 to 38,240 bytes and
contains each revision's unique marker. The failed third compilation leaves
PID 12299, its generation, checkpoint bytes and revision-two HTTP response
unchanged across ten samples. The health worker initializes through PM with
zero startup failures. The successful run verifies native process/unit cleanup,
removes only its own Docker container/network and restores source/site inputs.

`source-refresh-native-website-3.log` and
`omnitron-handoff-website-SoX2BR/result.json` under the same evidence directory
record this acceptance. The preceding replay completed the production checks
but failed while writing its fixture result because of a shadowed constant;
the scenario was corrected, syntax/lint checked and replayed against the same
immutable runtime before accepting success. No manual application restart or
replacement of active output substituted for an SDK refresh. This proves the
isolated managed website path, not browser HMR, compatibility after backend
rollback, later pipeline changes, remote CI or final release qualification.

The reference website on SDK `1ede1aea` passes typecheck, its ordinary build,
239-page output validation, preservation of 236 original routes and 2,855
anchors, 46,119 link/asset checks and twelve Chromium scenarios. The latter cover
the real lazy API, diagrams, execution, types, formulas, themes and mobile
layouts at 320, 768 and 1,440 pixels in light and dark themes. Sixteen screenshots
record the layouts and narrow-screen scientific content. The earlier count of
3,092 anchors included 237 Docusaurus renderer IDs; the migration inventory
records all original IDs and their explicit structural exclusions. Its registry
lockfile and production publication remain pending the qualified 0.4.0 npm
release; a development SDK receipt is not registry evidence.

## Release-bound pipeline execution

The source checkpoint `8ac5ade4`, with its public fixture corrected in
`6579131c`, separates a pipeline's immutable producer identity from the physical
installation used for an attempt. A `release` step names a registered
project/stack/application, exact artifact and compiled member. The existing
installed-release verifier resolves the selected closure without installing,
selecting or rewriting anything. Xec retains command execution, streams,
cancellation and retries. The attempt records its actual owner, controller
epoch, native process lifetime, Node image and installation digest.

Independent review found and closed three admission/recovery defects:

- A backend retaining an observer connection could treat another controller's
  grant as its own. Fresh admission now checks the held grant against both the
  returned observation and the latest retained inventory. The same fence
  protects shell, Xec and release steps; a delayed old reply cannot undo an
  already observed takeover.
- A process may start before its acknowledgement becomes durable. On recovery,
  unfinished `prepared` and `started` attempts become `unconfirmed`; completed
  evidence remains distinct. Failure to persist a completion also refuses
  automatic replay of that attempt. This is not an exactly-once guarantee.
- A dependency-free installed application could borrow native libraries from
  an ancestor closure. Verified execution now bounds the common library
  scanner to the admitted physical root and rejects explicit or inherited
  native-loader overrides. Classic/topology launches, declaration readers and
  local/remote sealed migrations use the same boundary.

The combined source run on Node 24.13.0 passes 196 checks in sixteen files,
including real Xec children, durable SQLite interruption/failing-write tests,
Netron takeover/reordered-response tests and Console definition preservation.
One existing Linux-only ELF test is skipped on macOS and still needs the Linux
gate. Backend, test and Console typechecks and scoped lint pass. The corrected
synthetic public fixture was then rechecked with all 31 pipeline integration
tests. These counts overlap the narrower closure checks; they are not additive.
The exact source and log digests are recorded in
`/Volumes/AGI-Dev/work/omnitron/pipeline-release-receipt.json`.

This proves the new source contract, not activation of an existing frozen
caller. An application which still constructs shell definitions from physical
installation paths needs a reviewed new artifact and an explicit conditional
update of its registration. Existing history and running registrations are not
silently rewritten. Release steps currently require a local resident owner;
unsupported remote execution is rejected explicitly. Final clean archives,
exact-commit CI and native transition/rollback qualification remain separate
release gates.

## Release evidence boundaries

The `08271086` GitHub run did not qualify the release. Lint passed, but the
standing scanner imported unbuilt browser fixtures, recovery fixtures omitted
the sealed application closure, and full-suite search assertions depended on
wall-clock sleeps. The scanner now defers runtime imports until fixture startup;
recovery fixtures use the actual closure builder; search assertions await the
observable adapter/RPC result. Independent Turbo test branches continue after
a failure so their outcomes remain visible, while the overall command still
fails and cleans its own resources.

The corrected source checks pass on a clean Linux Node 22.23.4 build: 29 recovery,
workspace-resolution and migration checks, and all 52 Lumen UI checks. This is
scoped acceptance, not a replacement for complete exact-commit CI. A subsequent
isolated Linux run passes the later CI groups: 76 stack/schema, 20 RPC-role,
28 telemetry-relay, 474 delivery/Console and 21 Prism checks. These groups
overlap earlier scoped counts and must not be summed as unique coverage.
The offline SDK-bootstrap fixture also depended on a warm global pnpm-manager
cache. It now verifies the exact repository-pinned tool before using pnpm's
externally managed mode and gives each fixture its own empty cache. Twenty-three
cases pass in the Linux suite; two subsequent focused checks cover the corrected
concurrent-write expectation and a new existing manager-only lock case. These
25 distinct cases preserve absent/stale/manager-only lock states, failed builds
and registry admission. They do not claim automatic manager installation.

The retained evidence for `72cc6084` identifies two independent sources of
non-determinism in `lumen-ast`; the other 34 archives match. The local Node 26
run changes the inferred Zod enum property order in a shared declaration,
therefore also its chunk name and importing declaration. A two-file Compiler
API reproduction produces both exact orders by changing the sequence of
per-module declaration emission; tsup's declaration plugin follows asynchronous
module visitation. The Linux Node 22 CI run instead changes the order of shared
JavaScript imports in `dist/index.js`. Eight isolated package builds produce
four byte variants before tsup's Rollup pass; repeatedly processing an identical
input with that Rollup pass stays stable. The JavaScript defect is in the
esbuild splitting stage, independently of declaration emission.

Neither difference is excluded from the equality gate or normalized away.
The candidate remains unqualified. CI retains bounded per-file evidence and
affected public archives, including the [Linux failure artifact](https://github.com/omnitron-dev/omni/actions/runs/43217732489/artifacts/13943709847).
Local reproductions are under
`/Volumes/AGI-Dev/work/omnitron/lumen-ast-repro-72cc` and
`/Volumes/AGI-Dev/work/omnitron/lumen-runtime-repro-72cc`.

The reference website also passes a fresh SDK `08271086` acceptance through the
ordinary SDK and Lumen commands: 239 pages, 236 preserved original routes, 2,855
content anchors, 46,121 link/asset checks and twelve Chromium scenarios. Desktop
and 320-pixel mobile screenshots were inspected. The website remains on its
migration branch until a frozen installation from published 0.4.0 registry
packages passes the same gates. Its development SDK receipt does not qualify
the registry lockfile or authorize a production Console update.

The final release review found three separate gaps in the preparation recipe:

- Read-only publication reconstructed the qualification key using the publisher's
  Node version. It must instead verify the selected producer identity, including
  its exact commit, policy and Node, without dispatching jobs or writing receipts.
  A new qualification still belongs to the Node that actually builds it.
- Runtime verification imported its implementation from the payload before
  checking that payload's bytes. Qualification and native artifact packaging now
  use the existing builtins-only verifier from the reviewed source checkout.
  Retained native bytes use that same implementation; downloaded code is never
  used to verify itself.
- Prepared npm archives and two independently reproduced SDK builds were checked
  separately. The qualification now binds both complete inventories through the
  existing bounded archive parser, comparing every file and executable flag.
  Only the canonical ordering of the five dependency maps and a verified root
  `gitHead` can differ. Export-condition order, bundled metadata, dependency edges
  and additional files remain significant. Publication repeats this read-only
  comparison; it does not rebuild, extract or execute npm payloads.

The archive comparator passes 40 checks across four suites on Node 24.13.0 and
26.12.1, plus source typecheck and lint. Its ordinary Xec invocation also matches
all 35 retained `1ede1aea` archive pairs and 6,804 files. This confirms the older
draft's bytes; it does not certify the replacement candidate. Evidence is in
`/Volumes/AGI-Dev/work/omnitron/archive-equivalence-qa/retained-35-pairs.log`.
The qualification/native-delivery profile passes 35 checks on both Node 24.13.0
and 26.12.1. A replay of the old implementation rejects a different publisher
Node and executes a tampered verifier; the corrected implementation preserves
the recorded producer identity and rejects the modified bytes before import.
The newly compiled archive inspector also matches all 35 retained pairs under
Node 26.12.1. All fifteen standing source gates pass. The separate full
release/loopback-registry, update and package-import profile passes all fifteen
checks under Node 26.12.1 in an isolated frozen dependency installation. An
earlier primary-checkout run stopped before publication on its stale TypeScript
resolution; the live-sensitive primary dependency tree was not changed.
The exact final candidate still requires clean preparation, independent builds,
CI and native transition/rollback on each release-policy Node version.

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

The subsequent canonical preparation completed for
`1ede1aea64f3876994e01d424309c070f54ad0be` on Node 24.13.0. All 35 public archives
passed the installed-consumer gate, including clean npm lockfile replay, audit,
the separate declared Lumen closure, native SSR peer acceptance, official stdio
MCP clients and actual CLI-to-Chromium tests. The latter include L40-20's custom
SSR layout followed by lazy client imports; they do not bypass the CLI by calling
the SSG directly.

Two independent clean builds matched the runtime, Console and all 6,804 SDK
files. The recorded runtime digest is
`8045c474023ffe60525bdeca63b13bceaf9652bcb072cd882ae0cc1a3ce4aad3`; the SDK
manifest digest is
`c6bd57e4888da81fb6b978d54250a14fc31da1c23083003977f16d5504a103f9`.
These are completed local build/archive results for that exact candidate, not
publication or certification of the later watcher changes. Its qualification
receipt records the reproducibility stage; native qualification is still empty.
The replacement candidate requires its own clean preparation and exact-commit
remote CI/native qualification before release.

Local evidence is retained under `/Volumes/AGI-Dev/work`:

- `omnitron/releases/prepare-0.4.0-1ede1aea.log` records preparation of all 35
  archives.
- `omnitron/releases/qualification/1ede1aea64f3876994e01d424309c070f54ad0be/796e19e85877c83589c86686e24c2d2b535ca4b7fc9d24838dcb0c694e2dfb3c/qualification.json`
  records stage boundaries; its `build/QUALIFICATION.json` records the matching
  independent builds and artifact digests.
- `omnitron-website/artifacts/website-reference-qualification.log` records the
  actual SDK source checks, site build, route/anchor inventory and twelve passing
  browser scenarios. `omnitron-website/artifacts/reference-browser/` contains the
  sixteen screenshots.
- `omnitron/managed-website-proof.log` records successful isolated managed startup
  and the watch-inventory refusal. It provides no evidence of automatic SDK
  refresh; the later successful replay above closes that scoped acceptance.
- `omnitron/source-refresh-qa-tests-4.log`,
  `omnitron/source-refresh-qa-types-4.log` and
  `omnitron/source-refresh-qa-lint-4.log` record the 126-check core watcher/RPC
  source checkpoint. They do not certify subsequent SDK checkpoint changes.
- `omnitron/source-refresh-receipt-tests.log`,
  `omnitron/source-refresh-receipt-types.log` and
  `omnitron/source-refresh-receipt-lint.log` record the 239-check owner-receipt
  checkpoint, independently of the later complete SDK/website acceptance.

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
its twelve browser scenarios cover real search, execution, types, formulas,
diagrams and both themes at three viewport widths. These interaction and visual
checks are not a complete accessibility audit. Large-corpus performance budgets,
external-inventory linking, full RTL qualification and broader scientific-output
parity remain separately unqualified; they must not be implied by the 0.4.0 release
description.

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
  actual HTTP/Netron checks pass. The official-client tests also pass through the
  installed `1ede1aea` archives, with the candidate boundary recorded above.

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
the installed `1ede1aea` archive gate also exercises the interpreter and actual
compiled browser worker. Those results do not certify a later candidate or
expand the interpreter's declared capabilities.

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
