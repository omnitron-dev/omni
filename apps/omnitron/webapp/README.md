# Omnitron Console

The management UI for Omnitron. This private workspace application uses React, Vite and Prism, and communicates with Omnitron services through Netron.

## Capabilities

- Project, stack and application status and lifecycle controls.
- Logs, metrics, health and pipeline run inspection.
- Runtime catalogs, reviewed backend rollouts and reconciliation.
- Shared permission-aware actions and operational receipts.

## Workspace selection

Choose a project in the header, then choose **All stacks** or an individual stack. The stack inventory, applications, logs, metrics, topology, containers and deployment views follow that selection. The Releases page keeps the project's artifact catalog available and narrows deployment observations and the proposed deployment target to the selected stack.

On a stack detail page, selecting another stack opens its details. Selecting **All stacks** opens the inventory. Browser Back, Forward and reload restore the workspace for that history entry. Controller-wide pages such as Audit and System omit the stack filter.

## Quick start

Install and build the workspace dependencies as described in the [root README](../../../README.md), then run from this directory:

```sh
pnpm dev
```

The development server listens on `http://localhost:9810`. Its configured proxies target the local Omnitron HTTP service on port 9801 and WebSocket service on port 9802. A working backend and an authorized session are required for management operations.

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm test:browser
```

`build` uses the Console publisher to validate a staged build before replacing `dist`. Browser tests use a private loopback fixture; install Playwright's Chromium first if it is unavailable, or set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome.

## Runtime operations

**Nodes → Managed backend updates** prepares a rollout from selected catalog builds or an exact commit. Review the node checks, owner and rollback artifacts before applying the plan. **Stage from controller catalog** explicitly transfers missing runtimes; leaving it unchecked inspects already staged artifacts.

A receipt link with `?rollout=…` opens the same operation after reload. If acknowledgement is lost, use **Reconcile node status** to inspect its outcome. Browser permissions do not replace the backend's authorization or lifecycle checks.

## Contributing

Use Prism and the shared theme for controls, visible focus and responsive layout. Preserve existing permission gates and confirmation flows. The shared `RowActions` component owns overflow-menu ordering; `usePolledResource.refresh` joins a fresh read after mutations. Reuse those mechanisms instead of adding page-specific polling or retry loops.

## Documentation

[Omnitron](../README.md) · [Scripts](package.json) · [Vite configuration](vite.config.ts) · [Source](src)

## License

[MIT](../../../LICENSE).
