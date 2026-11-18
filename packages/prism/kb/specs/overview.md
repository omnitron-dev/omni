---
module: prism
title: 'Prism Design System'
tags: [ui, design-system, mui, components, forms, theme, react]
summary: 'MUI v7-based design system with layouts, blocks, forms, Netron integration, and CLI'
depends_on: [netron-browser, netron-react]
---

## Architecture

Prism is a high-level design system built on MUI v7. It provides:

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
