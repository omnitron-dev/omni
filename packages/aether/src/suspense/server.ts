/**
 * Server-Only Suspense Features (SSR Streaming)
 *
 * ⚠️ DO NOT IMPORT IN BROWSER CODE
 *
 * This module contains server-side rendering and streaming utilities
 * that depend on Node.js APIs (like the 'stream' module).
 *
 * Usage:
 * ```typescript
 * // Server-side only
 * import { renderWithSuspenseStreaming } from '@omnitron-dev/aether/suspense/server';
 * ```
 *
 * @packageDocumentation
 */

// SSR streaming - Node.js only
export {
  streamSuspenseBoundaries,
  createSSRSuspenseContext,
  createSuspensePlaceholder,
  extractSuspenseBoundaries,
  renderWithSuspenseStreaming,
  renderToReadableStreamWithSuspense,
  hydrateSuspenseBoundaries,
} from './streaming.js';

// Server-only types
export type {
  SSRSuspenseContext,
  SuspenseBoundaryMarker,
  StreamingSuspenseOptions,
} from './types.js';
