# @omnitron-dev/prism

Prism provides UI components and composition tools for React applications. It builds on MUI and supplies a shared theme for navigation, forms, data displays and research documents.

## Capabilities

- Theme primitives, application layouts, forms and navigation.
- Tables, charts, maps, calendars and editors through dedicated component entries.
- Research Markdown rendering, validated widgets, diagrams and source-preserving editing.
- Shared providers and styles for applications using the Omni frontend packages.

## Quick start

```sh
pnpm add @omnitron-dev/prism react react-dom
```

```tsx
'use client';

import { Button, PrismThemeProvider, TextField } from '@omnitron-dev/prism/ui';
import { createPrismTheme } from '@omnitron-dev/prism/theme';

const theme = createPrismTheme({ mode: 'light' });

export function App() {
  return (
    <PrismThemeProvider theme={theme} defaultMode="light">
      <TextField label="Title" size="small" />
      <Button variant="contained">Save</Button>
    </PrismThemeProvider>
  );
}
```

`PrismThemeProvider` suits applications that own appearance preferences. `PrismProvider` also supplies settings and localization. Configure control appearance through the shared theme and preserve visible keyboard focus.

Prism does not force smooth document scrolling. Keep native fragment navigation immediate; opt into animation for a specific interaction and respect reduced-motion preferences.

For a server-rendered site, use `PrismProvider modeStorageKey="site-theme"` and place `PrismThemeScript` from `@omnitron-dev/prism/core` before visible content. Both use `defaultMode="system"` unless specified. MUI owns persistence and operating-system changes; both palettes are emitted before React loads, with a CSS system fallback when JavaScript or storage is unavailable. A controlled `mode` and `onModeChange` instead keep ownership in the parent; do not combine them with `modeStorageKey`. Without either, the provider uses Prism's settings store.

`defaultSettings` supplies initial application preferences for the settings-store mode. Saved values take precedence, including an explicit light theme. Defaults are applied once before the first client paint; remounting the provider does not reset a user's selection. Controlled and MUI-persisted modes keep their own mode authority.

Use `theme.vars` and `theme.applyStyles()` for mode-dependent component CSS. Application `themeOverrides` callbacks compile both palettes; their typography and component definitions should not change with the callback's mode. SSR and the initial client tree share the same provider configuration.

Native persisted selection requires CSS variables. An application that explicitly disables them can still use controlled or settings-store modes; its system mode resolves in JavaScript and cannot promise a system-matched first paint on the server.

The CSS baseline styles Shiki's dual-theme tokens for static and interactive code. `syntaxHighlightStyles(theme)` from the theme entry provides the same rules for a standalone code component. Keep the shared styles; sites do not need separate light/dark syntax selectors.

Public component subpaths provide lazy-loading boundaries. Import the documented CSS entry for components that need it. Unused editor, map and chart modules can be removed from production bundles. UI entries declare a React client boundary; `@omnitron-dev/prism/http` is also available to server code.

## Shared application controls

Use `ThemeModeIcon` from `@omnitron-dev/prism/icons` for the selected `light`, `dark` or `system` preference. The semantic `themeLight`, `themeDark` and `themeSystem` slots can be customized through `PrismIconProvider`. Give the surrounding button an accessible action label and use Prism settings to persist the preference.

`LoadingScreen` accepts a branded progress indicator through `slots.progress`. Its existing layout and motion behavior allow applications to share the loading component while supplying their own identity. Use `EmptyContent` for an empty result with a title, description and optional action.

The map entry includes its matching MapLibre worker. Consumers can use `@omnitron-dev/prism/components/map` without configuring a separate worker asset. An explicit `workerUrl` selects a consumer-managed worker when deployment policy requires one.

The documentation catalog pairs rendered examples with their checked-in TypeScript modules. Examples use the public package entries and cover forms, navigation, tables, charts, maps, editors and research documents.

`CursorPagination` in `@omnitron-dev/prism/components/table` provides controlled first, previous and next actions for opaque server cursors. The application supplies available actions, pending state, localized labels and observed item counts. Keyboard focus survives a pending request and the final page. Applications can use the same control for page replacement or appending results.

## Research documents and authoring

`@omnitron-dev/prism/components/research` exports `ResearchDocument`, `parseResearchMarkdown` and validated widget definitions. Import `@omnitron-dev/prism/components/research/styles.css` once. The renderer supports GFM, heading anchors, admonitions, tabs, KaTeX and strict Mermaid diagrams.

Documents cannot import code or grant permissions. Host applications register widgets and validate their versioned props. Raw HTML and unsupported constructs remain inert with diagnostics. Mermaid output is sanitized and displayed as an isolated SVG image. Labels admit text formatting before measurement; measured XHTML wrappers retain a limited set of text-layout styles, without links, resources, events or arbitrary CSS. Quoted labels and Mermaid entity codes therefore render as text without injecting SVG into the host document. Source-size limits do not impose a browser execution-time limit.

`@omnitron-dev/prism/components/research-editor` accepts the original document through `initialSource`. Save the resulting snapshot's `getSource()` through the host's revision and authorization checks. An unchanged snapshot preserves the original source bytes. A projected or cleaned Markdown export is not a lossless replacement for that source.

## Documentation

[Public API](src/index.ts) · [Package exports and styles](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
