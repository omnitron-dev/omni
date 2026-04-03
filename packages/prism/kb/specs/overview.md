---
module: prism
title: "Prism Design System"
tags: [ui, design-system, mui, components, forms, theme, react]
summary: "MUI v7-based design system with layouts, blocks, forms, Netron integration, and CLI"
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
2. **Netron RPC** goes through `@omnitron/prism/netron`, never raw fetch
3. **Icons**: HugeIcons Duotone Rounded as primary set, at `src/assets/svg-icons/`
4. **Never use `@mui/icons-material`** — use custom SVG icons
5. **State**: Zustand v5 for app state, react-hook-form for form state

## Import Pattern
```typescript
import { PrismProvider } from '@omnitron/prism';
import { DashboardLayout } from '@omnitron/prism/layouts';
import { DataGridBlock } from '@omnitron/prism/blocks/data-grid';
import { OtpInput } from '@omnitron/prism/components';
import { MultiBackendProvider } from '@omnitron/prism/netron';
```
