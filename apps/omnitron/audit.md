# Console, access and SSH audit

Verified on 2026-10-28 against the current working tree. This review covers the human control plane, terminal lifecycle, shared CLI contracts and the affected Titan, Prism and Xec paths. Live verification used the local master and harmless SSH commands on an existing registered node; remote application workloads were not changed.

## Delivered behavior

| Area | Implementation and evidence |
| --- | --- |
| Effective permissions | `OmnitronAccess.describe()` derives capabilities from active Titan RPC metadata and Netron authorization. Console has typed method permissions and no independent role matrix. |
| Account administration | Safe keyset-paginated listings, creation, compare-and-swap role changes and explicit session revocation. Password hashes, second-factor secrets and sessions are absent from account responses. |
| Concurrent administration | PostgreSQL transaction lock, current actor recheck, last-admin protection and no self role changes. Mutations and their audit rows commit together or roll back together. |
| Revocation | Current database role during human token validation; cache eviction plus persistent-peer authority removal after account changes. Titan prevents in-flight validation from restoring an invalidated grant. |
| Password/session consistency | Creation and password changes share a 15-character / 256-byte UTF-8 policy. Password update and other-session deletion are transactional. Logout and password changes invalidate cached authority. |
| Console integration | Permission-gated routes, navigation, lifecycle/deploy/node/account controls and dialogs. Failed permission refresh clears UI grants. Prism evaluates role guards synchronously during render. |
| SSH | Existing Xec `NodeSSH` through `@xec-sh/core/ssh`. Omnitron adds control-plane ownership, limits and audit, with no direct SSH-library dependency or second SSH transport. |
| Host trust | Pre-auth key observation, independently verified SHA256 pins, compare-and-swap replacement, target binding and required audit before trust changes/opening. |
| Terminal lifecycle | Live human/admin checks, account-plus-session ownership, two-second revocation sweep, idle/absolute/disconnect limits, bounded binary output and sequenced input without command replay. |
| Productivity | Independent tabs, split view, search, font controls, selection copying, read-only panes and multi-line/control-character paste review. Tabs survive in-app navigation. CLI shares the same RPC. |
| Xec lifecycle | Cancellable connection setup; bounded shell requests with late-channel cleanup; forced/graceful disposal. Pool identity and reconnect retain trust policy. Real SSH/PTY fixture repaired to exercise actual byte streams and resize. |
| Optional frontend features | 20 explicit Prism component entry points plus guard-only `./auth`, each with matching JS and declarations. Console uses narrow imports. Maps/editors remain opt-in and xterm remains a lazy route dependency. |

## Validation

- Omnitron regression run: **256 tests passed in 47 files**, covering the webapp and terminal, authentication, role, RPC authorization and anonymous-input unit suites. A later focused access UI run passed **5 tests**, including the newly added account-pagination race regression (four overlap with the broader run).
- Real PostgreSQL and HTTP: **8 tests passed** across console account authority and terminal ownership. Isolated databases were migrated and removed by the fixtures. Cases include forbidden roles, last administrator, stale concurrent edits, failed audit rollback, revoked cached tokens, sign-out and password changes.
- Browser byte/URL helpers: **6 tests passed**; raw terminal bytes, safe paste classification, secure origin and log-link/CLI quoting behavior.
- Prism: **15 guard tests passed**, including no protected-child render after revocation.
- Titan: **8 token-cache invalidation tests passed**; these tests do not use Redis (the test harness used MockRedis).
- Xec: **93 tests passed** across the low-level SSH/PTY/validation/lifecycle suites and known-hosts, pool and reconnect-policy suites. Real PTY tests verified a pinned connection, refusal before authentication, output and resize.
- Builds passed for Omnitron backend/webapp, Prism and Xec core. Titan was rebuilt for the cache change. All **43 Prism JavaScript/declaration entry pairs** exist in the build.
- Repository source scans: **15 gates passed**. Website checks: **8 source checks passed**, API catalog updated, content boundary check and static production build passed. Xec docs: **1,396 examples compiled**, with 77 explicitly classified as incomplete snippets and zero wrong examples.
- Isolated browser verification used a temporary PostgreSQL database and a loopback SSH server. Confirmed admin account controls, viewer denial on direct SSH navigation, viewer-only capability view, two real SSH tabs, split view, execution, paste review, read-only mode and navigation persistence.
- Activated Console verification repeated the access checks against the running master: the administrator saw the metadata-derived catalog; a temporary operator and then viewer could not enter the SSH route or administer accounts; demotion revoked the old browser session. The viewer could read status but could not restart applications. The test account and its sessions were removed; audit records remain.
- Live SSH verification matched an existing independently trusted ED25519 fingerprint, opened two sessions, executed `hostname` and `stty size`, and checked split view, disabled input, paste review and persistence across navigation to Audit. The audit page showed host-key trust, terminal opening and the account role change. The CLI could not list the browser user's sessions, consistent with account-and-session ownership.

## Build measurement

The same production Console build before and after narrow Prism imports:

| Metric | Before | After |
| --- | ---: | ---: |
| Total emitted JavaScript | 4,720.71 kB | 3,141.25 kB |
| Sum of gzip JavaScript sizes | 1,381.09 kB | 944.51 kB |
| Emitted JavaScript chunks | 47 | 67 |

These totals include lazy routes; they are not first-load transfer measurements. Unused MapLibre output disappeared. SSH is a separate 376 kB raw / 97 kB gzip chunk. The app shell and ApexCharts still exceed Vite's 500 kB chunk warning threshold; the warning is retained.

## Boundaries and remaining work

- Human Console roles are the existing fixed `viewer`, `operator`, `admin` hierarchy. Custom roles, tenant/project-scoped grants, account suspension, invitations, SSO and MFA/passkey enrollment are not part of this implementation. Project selection is a workspace filter, not tenant isolation.
- The existing bootstrap migration still seeds `admin` / `admin`. Existing Console publication logic falls back to loopback while it remains unchanged. Fleet TCP publication only logs a warning. Rotate the bootstrap password before external exposure; a universal first-login enrollment gate remains future work. No existing account credentials were changed during this audit.
- Account mutations fail closed if transactional audit fails. Terminal trust/opening requires an audit write; completion records are best effort. Older operational services retain their existing best-effort audit behavior. There is no tamper-evident external audit archive.
- Terminal audit contains session metadata, not commands or transcripts. Access to an SSH shell has the rights of the configured remote OS account. Use suitably restricted node credentials.
- Browser reload/daemon restart does not reattach shells. Durable sessions, collaboration, command recording, SFTP UI, agent forwarding and jump-host configuration require separate authorization/lifecycle work. A remote multiplexer is the current option for jobs that must outlive the connection.
- Remote deployments, multi-process revocation distribution, network partitions across a live fleet and the entire repository's integration matrix were not exercised. The documented selected suites are the evidence for this change.
- Xec integration uses verified archives built from its source repository. `vendor/xec-manifest.json` records the source commit, archive digest and package closure; workspace overrides select the same artifacts for every consumer. Interactive SSH and the process-tree deadline are implemented and tested in Xec itself.

## Activation and documentation

Backend services are registered on a master at startup. Backend and frontend were activated together after the operator approved a controlled pause of local applications. The local master now runs version 0.3.1 with `OmnitronAccess` and `OmnitronTerminal`; the served Console uses both. Remote daemon and application PIDs were compared before and after and remained unchanged. Packages and the documentation site were not published, Git history was not pushed, and other working branches were not modified.

The local `omnitron-nginx` container directly bind-mounts `webapp/dist`. An earlier validation build exposed new assets before backend activation; a compatible UI was restored while the coordinated release was staged separately. Activation included a database/state snapshot, the previous backend and frontend, and a manifest of reversible runtime links. Future validation builds must continue to use a separate output directory.

Restart exposed existing runtime drift: a missing native executable, incompatible physical copies of Titan, and installed packages missing current exports. The executable was rebuilt offline; 14 backend package links in two consuming projects were repaired with explicit operator approval. Fourteen of eighteen applications are now online, including one previously errored worker group. Three pre-existing application failures remain. One previously online research worker refuses to restart because its immutable runtime manifest describes older package trees for which no archive exists. Its integrity guard and experiment registration were preserved. Equal aggregate online counts do not mean that the original application set was fully restored.

An upgrade preflight must therefore check restartability, resolved package identity and native artifacts, not only process liveness. A source commit and dependency hash are insufficient rollback artifacts for a development-linked or immutable workload: preserve the actual dependency trees, lockfiles, runtime and binaries before changing them. An experiment whose original runtime cannot be recovered needs a separately registered continuation; rewriting its old hash would misrepresent its history.

Maintained guides live in `internal/website`: Console access, SSH workspace, auth/RBAC, CLI, configuration, services reference and Prism component/guard imports. Xec's own SSH documentation describes the shared low-level API and its ownership boundary.
