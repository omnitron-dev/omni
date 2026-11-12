# Omnitron identity

`@omnitron-dev/prism/identity` supplies the shared mark, palette, typography, and loading states for Console and the website. It extends the existing Prism/MUI theme.

```tsx
import { PrismProvider } from '@omnitron-dev/prism/core';
import { OmnitronBrand, omnitronTheme } from '@omnitron-dev/prism/identity';

export function BrandedShell() {
  return (
    <PrismProvider mode="dark" themeOverrides={omnitronTheme}>
      <OmnitronBrand />
    </PrismProvider>
  );
}
```

Use controlled `mode` and `onModeChange` when the host owns theme selection. SSR must use the same initial mode as the client. Static shell styles can consume `omnitronCssVariables('light' | 'dark')`; tokens and React components share that palette. Load the Inter font weights used by the application.

- [Tokens](tokens.ts) and [theme overrides](theme.ts): surfaces, text, borders, focus, spacing, and typography.
- [Mark geometry](geometry.ts): shared SVG geometry and `omnitronMarkSvg` for static assets.
- [Mark and wordmark](omnitron-mark.tsx): `OmnitronMark` and `OmnitronBrand`.
- [Loading state](omnitron-splash.tsx): `OmnitronSplash` with `loading`, `success`, or `error`.

Use `label={null}` on a mark when adjacent text already names it. Loading motion respects reduced-motion preferences and pauses when hidden or outside the viewport. Supply `progress` only as a measured percentage from 0 to 100; omit it for work with no known total. Error states should include a useful message and, where appropriate, an action.
