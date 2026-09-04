/// <reference types="vite/client" />

/**
 * Side-effect CSS imports.
 *
 * TypeScript 7 reports `TS2882` for a side-effect import with no declaration,
 * where earlier versions stayed silent — so the console's font and library
 * stylesheet imports (`@fontsource/inter/400.css`,
 * `@xyflow/react/dist/style.css`, …) surfaced as errors the moment the
 * compiler was upgraded. Vite resolves them at build time; this tells the
 * type checker they exist.
 */
declare module '*.css';
declare module '*.scss';
