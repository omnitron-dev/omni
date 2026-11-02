# @omnitron/console

> Admin console for the Omnitron supervisor

Part of the [Omni](../../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Overview

A Vite + React application providing a web-based admin interface for the Omnitron supervisor. Built with the Prism design system and connected to backend services via Netron RPC.

## Development

```bash
pnpm dev
```

Runs on `http://localhost:5173` by default.

## Build

```bash
pnpm build
```

Output goes to `dist/`.

## Manage a backend rollout

Open **Nodes → Managed backend updates** to inspect the controller's latest receipt. Administrators can choose a catalog build by commit, platform and Node.js version, enter a commit manually, or use the running controller's verified clean commit and choose remote nodes in rollout order. **Stage from controller catalog** transfers and installs missing runtimes during preparation. Leave it unchecked to inspect runtimes already staged on the nodes. Follow the node checks, then review each owner and rollback artifact before selecting **Apply reviewed plan**. A link containing `?rollout=…` opens that exact receipt after a reload.

If a handoff loses its acknowledgement, **Reconcile node status** asks the controller to check the affected runtime. The receipt records the result. Source-bundle upgrades are under **Advanced**.

## Browser tests

Run the workspace and topology checks from this directory. Playwright serves the Console components on a private loopback port with a fixed inventory.

```bash
pnpm exec playwright install chromium
pnpm test:browser
```

The suite uses the Console build configuration and its real routing worker. It checks shared
dependencies, keyboard and mouse positioning, persistence, the inspector and minimap bounds at
320, 768 and 1440 CSS pixels. Workspace checks select a project and measure the stack selector,
toolbar and content against both expanded and collapsed rails in LTR and RTL. Set
`PLAYWRIGHT_CHANNEL=chrome` to use locally installed Chrome.

## License

MIT
