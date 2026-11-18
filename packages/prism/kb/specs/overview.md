---
module: prism
title: 'Prism Design System'
tags: [ui, design-system, mui, components, forms, theme, react]
summary: 'MUI-based design system with layouts, blocks, forms, Netron integration, and CLI'
depends_on: [netron-browser, netron-react]
---

## Architecture

Prism is a high-level design system built on MUI. It provides:

- **Theme** — Dark/light themes, color palettes, typography
- **Core** — Base components, hooks, accessibility
- **Layouts** — DashboardLayout, AuthLayout, SplitLayout
- **Blocks** — Complex UI blocks (DataGrid, Auth forms, Dashboard widgets)
- **Components** — Reusable components (Tabs, Settings panels, OtpInput)
- **Forms** — react-hook-form + zod v4 integration
- **Netron** — MultiBackendProvider, useBackendService (wraps netron-react)
- **CLI** — `prism` command for scaffolding

## Key Rules

1. **ALL reusable features MUST be in Prism**, not in portal app
2. **Netron RPC** goes through `@omnitron-dev/prism/netron`, never raw fetch
3. **Icons**: HugeIcons Duotone Rounded as primary set, at `src/assets/svg-icons/`
4. **Never use `@mui/icons-material`** — use custom SVG icons
5. **State**: Zustand v5 for app state, react-hook-form for form state

## Import Pattern

```typescript
import { PrismProvider } from '@omnitron-dev/prism';
import { DashboardLayout } from '@omnitron-dev/prism/layouts';
import { DataGridBlock } from '@omnitron-dev/prism/blocks/data-grid';
import { OtpInput } from '@omnitron-dev/prism/components';
import { MultiBackendProvider } from '@omnitron-dev/prism/netron';
```

## Responsive application headers

`DashboardLayout.headerSlots.topArea` and `bottomArea` reserve space inside the
application header. Use them for operational notices; viewport-fixed notices
can cover a sidebar or toolbar. `HeaderSection` keeps these areas in its sticky
surface and grows above its minimum toolbar height when slot groups wrap.

The left and right slot groups retain their preferred width and move to another
row when necessary. Center content can grow and shrink; an absent center slot
does not reserve a spacer. The same rules apply to `containerized` headers.
Do not add empty-center spacing or `leftArea.minWidth` workarounds in callers.
Inside a slot, long names need their own truncation or wrapping and flexible
children need `minWidth: 0`. A fixed-height toolbar or unbreakable group wider
than the viewport defeats this contract.


## Scrollable tabs and dependency ownership

Both the `ui` export of MUI Tabs and the higher-level Prism Tabs delegate scrolling
to `@mui/material`. A tab count belongs inside the label's flow; an absolutely
positioned badge does not reserve tab width. Use scrollable tabs for long labels
and preserve keyboard access to every tab instead of clipping the tab strip.

The installed MUI 9.5.0 scroll owner is corrected by
`patches/mui-material@9.5.0.patch`, declared in `pnpm-workspace.yaml` and the lock.
It retains the animation cancellation handle, cancels old animation before a new
animated or direct scroll, cancels when native focus has already revealed the
new selection, and cleans up on unmount. Both MUI CommonJS and ESM entries are
patched. `tests/e2e/tabs-scroll.spec.ts` checks selected-tab visibility after rapid
End/Enter/Home/Enter, ordinary horizontal/vertical keyboard movement, direct
reduced-motion scrolling and unmount.

MUI is external in the published Prism output. A consumer that installs or
deduplicates its own MUI must declare the same exact versioned patch in its
workspace; linked SDK selection alone does not inherit source workspace patches.
After installation, verify the effective dependency and the development lock,
not only the source lock. Do not add a consumer scroll workaround or a second
Tabs implementation. When upgrading MUI, rerun these regressions against the
unpatched dependency and remove the patch and its declarations together only
when the upstream version passes them.
