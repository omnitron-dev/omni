# Omni

Omni is a TypeScript platform for building, connecting and operating applications. Titan supplies backend lifecycle and dependency injection; Netron connects services and clients; Prism supplies React UI; Omnitron supervises applications; Lumen builds documentation from the same document model used by its UI and services.

The packages share contracts while keeping their responsibilities separate. Applications own domain logic, identity and deployment policy. TypeScript types help callers use an API; server-side validation and authorization remain explicit.

## Packages

| Area | Packages |
| --- | --- |
| Applications and operations | [Omnitron](apps/omnitron/README.md), [Console](apps/omnitron/webapp/README.md), [Titan](packages/titan/README.md), [process management](packages/titan-pm/README.md) |
| Service communication | [Netron browser client](packages/netron-browser/README.md), [React bindings](packages/netron-react/README.md), [protocol contracts](packages/netron-protocol/README.md), [HTTP core](packages/netron-http-core/README.md) |
| UI and documentation | [Prism](packages/prism/README.md), [Lumen](packages/lumen/README.md), [document AST](packages/lumen-ast/README.md), [Lumen UI](packages/lumen-ui/README.md), [migration](packages/lumen-migrate/README.md), [Titan Lumen](packages/titan-lumen/README.md) |
| Data and storage | [Database](packages/titan-database/README.md), [Redis](packages/titan-redis/README.md), [cache](packages/titan-cache/README.md), [storage](packages/titan-storage/README.md), [knowledge base](packages/kb/README.md) |
| Application services | [Authentication](packages/titan-auth/README.md), [access rules](packages/access/README.md), [events](packages/titan-events/README.md), [notifications](packages/titan-notifications/README.md), [mailer](packages/titan-mailer/README.md), [scheduler](packages/titan-scheduler/README.md) |
| Coordination and observability | [Discovery](packages/titan-discovery/README.md), [locks](packages/titan-lock/README.md), [rate limiting](packages/titan-ratelimit/README.md), [health](packages/titan-health/README.md), [metrics](packages/titan-metrics/README.md), [telemetry relay](packages/titan-telemetry-relay/README.md) |
| Shared utilities | [Common](packages/common/README.md), [CUID](packages/cuid/README.md), [event emitter](packages/eventemitter/README.md), [MessagePack](packages/msgpack/README.md), [testing](packages/testing/README.md) |

Each public package is published under `@omnitron-dev`. Package READMEs describe installation, the public entry points and the required host services. The Console is a private workspace application.

## Develop the workspace

Use Node.js 22.22.2+ on 22.x, 24.15+ on 24.x, or 26+ for the full development toolchain, and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check:scans
```

pnpm owns the workspace installation and lockfile. Turbo owns the dependency graph and build cache; Xec orchestrates repository and release workflows. Build through these commands so secondary package outputs are included.

```sh
pnpm test:ci
pnpm test:e2e
pnpm lint
```

Tests use Vitest, Node's test runner and Playwright. Integration suites require the services declared by their fixtures; use dedicated Redis and database instances. Package scripts provide narrower checks. `pnpm check:packages` exercises packed package consumers after a build, and `pnpm check:reproducibility` compares independent release builds.

To use a source checkout from another application, follow the [Omnitron SDK workflow](apps/omnitron/README.md#source-sdk-development). It builds the declared framework graph and manages a private development lock while preserving the registry baseline. Selecting an SDK does not deploy an application.

## Releases and runtime changes

Use the canonical Xec workflow:

The workspace uses Xec 0.12 for command execution, SDK source watching, kernel locks and CLI progress. Turbo supplies the build graph and cache; project scripts and release commands use the same installed tools.

```sh
pnpm exec xec release <version> --dry-run
pnpm exec xec release <version> --prepare --previous <full-commit> --push-source
pnpm exec xec release <version> --finish
```

Preparation checks registry availability and seals the archives against the exact source commit. Xec reports progress for three npm consumers: the minimal runtime, all public packages together and Lumen on its own. Each replays a fresh lockfile, checks the installed archive identities and runs an audit. The minimal runtime also exercises an ordinary install.

Finish verifies the recorded Node producer, independent builds and native transition evidence, then publishes the sealed archives.

Source development and npm publication do not activate managed applications. Backend and resident-owner updates, application release selection and infrastructure reconciliation have separate reviewed operations. Use the [Omnitron lifecycle documentation](apps/omnitron/README.md) for those boundaries.

After a committed local batch, `pnpm exec xec update local-sync` prepares the
local runtime, Console and stack transition for review. Set `OMNITRON_DEV_CACHE`
to a private development volume. Xec reuses a sealed local release build for the
same commit, platform, architecture and Node producer before building again;
reuse verifies its bytes locally and does not require a CI connection.
Apply the returned plan with `--review <digest>` only after reviewing its scope
and recovery instructions. Use `--status` to inspect an interrupted operation.

## Documentation

[Project documentation](https://omnitron.dev) · [Repository workflow](AGENTS.md) · [Release workflow](.xec/release.mjs) · [Qualification policy](.xec/release-policy.mjs)

## License

[MIT](LICENSE). Individual packages retain notices for bundled third-party assets.
