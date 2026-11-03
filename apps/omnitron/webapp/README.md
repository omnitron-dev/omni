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

## Consistent action placement

Horizontal card and row controls put removal first at the leading edge, separated
from ordinary commands by one extra theme spacing unit. Card footers keep ordinary
commands together at the trailing edge; groups wrap at narrow widths. Use MUI `sx`
for layout (`justifyContent`, `alignItems`, wrapping and gaps), and keep `direction`
and `spacing` as Stack props. Icon-only controls have an explicit accessible name
that identifies the resource.

The shared `RowActions` overflow menu puts destructive (`color: 'error'`) commands
last, separated from ordinary commands. Menu keyboard navigation and focus return
remain MUI's responsibility. Confirmation dialogs retain Cancel before the explicit
destructive confirmation; never move the confirmation into the initial/default
focus position just to match a toolbar. Preserve each command's `Can` permission,
disabled state and existing confirmation flow when changing its layout.

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
