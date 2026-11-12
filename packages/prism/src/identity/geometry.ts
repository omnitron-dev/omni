import { omnitronTokens } from './tokens.js';

/**
 * Four interlocking triangular planes around a stable central core.
 * Geometry is shared by React, the static SVG and server-rendered consumers.
 * No SVG engine, gradients, filters, masks, or per-frame JavaScript.
 */
export const omnitronMarkGeometry = {
  viewBox: '0 0 64 64',
  core: 'M23.545 43.786L43.837 37.929L28.618 23.285Z',
  facets: [
    { path: 'M22.023 44.226L8.496 48.131L30.478 10.056Z', x: -2.94, y: 0.849 },
    { path: 'M28.999 21.747L32.38 8.079L54.363 46.154Z', x: 0.735, y: -2.97 },
    { path: 'M44.978 39.027L55.124 48.79L11.159 48.79Z', x: 2.205, y: 2.122 },
  ],
} as const;

/** Standalone favicon/asset. Inline consumers should use OmnitronMark. */
export const omnitronMarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${omnitronMarkGeometry.viewBox}" fill="currentColor"><style>:root{color:${omnitronTokens.color.light.accent}}@media(prefers-color-scheme:dark){:root{color:${omnitronTokens.color.dark.accent}}}</style><path d="${omnitronMarkGeometry.core}"/>${omnitronMarkGeometry.facets.map(({ path }) => `<path d="${path}"/>`).join('')}</svg>`;
