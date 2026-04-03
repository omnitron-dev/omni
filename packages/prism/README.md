# @omnitron/prism

> Design system constructor — high-level UI building blocks for complex frontends

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron/prism
```

## Overview

Prism is a design system built on MUI v7, providing pre-composed, theme-aware components for building production frontends. All reusable UI — layouts, forms, navigation, data display — lives here so that application code stays thin.

### Key Features

- **MUI v7 foundation** — themed components with full customization
- **Layout system** — `DashboardLayout`, navigation items, sidebar, breadcrumbs
- **Form components** — integrated with react-hook-form + zod validation
- **Auth-aware** — components that respect authentication state
- **OTP input** — standalone OTP code input component
- **Avatar system** — default avatars, upload, presigned URL support

## Usage

```tsx
import { PrismProvider, DashboardLayout } from '@omnitron/prism';

function App() {
  return (
    <PrismProvider>
      <DashboardLayout navItems={items}>
        <Outlet />
      </DashboardLayout>
    </PrismProvider>
  );
}
```

## License

MIT
