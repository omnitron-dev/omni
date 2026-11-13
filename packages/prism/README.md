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
    <PrismThemeProvider theme={theme}>
      <TextField label="Title" size="small" />
      <Button variant="contained">Save</Button>
    </PrismThemeProvider>
  );
}
```

`PrismThemeProvider` suits applications that own appearance preferences. `PrismProvider` also supplies settings and localization. Configure control appearance through the shared theme and preserve visible keyboard focus.

Public component subpaths provide lazy-loading boundaries. Import the documented CSS entry for components that need it. Unused editor, map and chart modules can be removed from production bundles. UI entries declare a React client boundary; `@omnitron-dev/prism/http` is also available to server code.

## Shared application controls

Use `ThemeModeIcon` from `@omnitron-dev/prism/icons` for the selected `light`, `dark` or `system` preference. The semantic `themeLight`, `themeDark` and `themeSystem` slots can be customized through `PrismIconProvider`. Give the surrounding button an accessible action label and use Prism settings to persist the preference.

`LoadingScreen` accepts a branded progress indicator through `slots.progress`. Its existing layout and motion behavior allow applications to share the loading component while supplying their own identity. Use `EmptyContent` for an empty result with a title, description and optional action.

The map entry includes its matching MapLibre worker. Consumers can use `@omnitron-dev/prism/components/map` without configuring a separate worker asset. An explicit `workerUrl` selects a consumer-managed worker when deployment policy requires one.

The documentation catalog pairs rendered examples with their checked-in TypeScript modules. Examples use the public package entries and cover forms, navigation, tables, charts, maps, editors and research documents.

## Research documents and authoring

`@omnitron-dev/prism/components/research` exports `ResearchDocument`, `parseResearchMarkdown` and validated widget definitions. Import `@omnitron-dev/prism/components/research/styles.css` once. The renderer supports GFM, heading anchors, admonitions, tabs, KaTeX and strict Mermaid diagrams.

Documents cannot import code or grant permissions. Host applications register widgets and validate their versioned props. Raw HTML and unsupported constructs remain inert with diagnostics. Mermaid output is sanitized and displayed as an isolated SVG image. Labels admit text formatting before measurement; measured XHTML wrappers retain a limited set of text-layout styles, without links, resources, events or arbitrary CSS. Quoted labels and Mermaid entity codes therefore render as text without injecting SVG into the host document. Source-size limits do not impose a browser execution-time limit.

`@omnitron-dev/prism/components/research-editor` accepts the original document through `initialSource`. Save the resulting snapshot's `getSource()` through the host's revision and authorization checks. An unchanged snapshot preserves the original source bytes. A projected or cleaned Markdown export is not a lossless replacement for that source.

## Documentation

[Public API](src/index.ts) · [Package exports and styles](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
