/**
 * SVG Compression and Optimization
 *
 * Provides tools for optimizing and compressing SVG content:
 * - Remove unnecessary metadata and comments
 * - Optimize paths and transforms
 * - Minify styles and IDs
 * - Compress to binary format
 *
 * @module svg/optimization/compress
 */

/**
 * SVG optimizer configuration
 */
export interface SVGOptimizerConfig {
  // Cleaning options
  removeComments?: boolean;
  removeMetadata?: boolean;
  removeTitle?: boolean;
  removeDesc?: boolean;
  removeUselessDefs?: boolean;
  removeEditorsNSData?: boolean;
  removeEmptyAttrs?: boolean;
  removeHiddenElems?: boolean;
  removeEmptyText?: boolean;
  removeEmptyContainers?: boolean;

  // Optimization options
  cleanupIds?: boolean;
  minifyStyles?: boolean;
  convertColors?: boolean | { currentColor: boolean };
  convertPathData?: boolean | { precision: number };
  convertTransform?: boolean;
  removeUnknownsAndDefaults?: boolean;
  removeNonInheritableGroupAttrs?: boolean;
  removeUselessStrokeAndFill?: boolean;
  removeUnusedNS?: boolean;

  // Shape optimization
  convertShapeToPath?: boolean;
  mergePaths?: boolean;

  // Precision
  floatPrecision?: number;
  transformPrecision?: number;
  pathDataPrecision?: number;
}

/**
 * Default optimization configuration
 */
const DEFAULT_CONFIG: Required<SVGOptimizerConfig> = {
  removeComments: true,
  removeMetadata: true,
  removeTitle: false,
  removeDesc: false,
  removeUselessDefs: true,
  removeEditorsNSData: true,
  removeEmptyAttrs: true,
  removeHiddenElems: true,
  removeEmptyText: true,
  removeEmptyContainers: true,
  cleanupIds: true,
  minifyStyles: true,
  convertColors: true,
  convertPathData: true,
  convertTransform: true,
  removeUnknownsAndDefaults: true,
  removeNonInheritableGroupAttrs: true,
  removeUselessStrokeAndFill: true,
  removeUnusedNS: true,
  convertShapeToPath: false,
  mergePaths: false,
  floatPrecision: 3,
  transformPrecision: 5,
  pathDataPrecision: 3,
};

/**
 * Parse SVG string to DOM
 */
function parseSVG(svg: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(svg, 'image/svg+xml');
}

/**
 * Serialize SVG DOM to string
 */
function serializeSVG(doc: Document): string {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

/**
 * Remove comments from SVG
 */
function removeComments(doc: Document): void {
  const comments: Node[] = [];
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);

  let node: Node | null;
  while ((node = walker.nextNode())) {
    comments.push(node);
  }

  for (const comment of comments) {
    comment.parentNode?.removeChild(comment);
  }
}

/**
 * Remove metadata elements
 */
function removeMetadata(doc: Document): void {
  const metadataElements = doc.querySelectorAll('metadata');
  for (const elem of metadataElements) {
    elem.parentNode?.removeChild(elem);
  }
}

/**
 * Remove title elements
 */
function removeTitle(doc: Document): void {
  const titleElements = doc.querySelectorAll('title');
  for (const elem of titleElements) {
    elem.parentNode?.removeChild(elem);
  }
}

/**
 * Remove desc elements
 */
function removeDesc(doc: Document): void {
  const descElements = doc.querySelectorAll('desc');
  for (const elem of descElements) {
    elem.parentNode?.removeChild(elem);
  }
}

/**
 * Remove editor namespace data
 */
function removeEditorsNSData(doc: Document): void {
  const svgElement = doc.documentElement;
  const attrs = Array.from(svgElement.attributes);

  for (const attr of attrs) {
    // Remove sketch, figma, adobe namespace attributes
    if (
      attr.name.startsWith('xmlns:sketch') ||
      attr.name.startsWith('xmlns:figma') ||
      attr.name.startsWith('xmlns:xlink') ||
      attr.name.startsWith('sketch:') ||
      attr.name.startsWith('figma:')
    ) {
      svgElement.removeAttribute(attr.name);
    }
  }
}

/**
 * Remove empty attributes
 */
function removeEmptyAttrs(doc: Document): void {
  const allElements = doc.querySelectorAll('*');
  for (const elem of allElements) {
    const attrs = Array.from(elem.attributes);
    for (const attr of attrs) {
      if (attr.value === '') {
        elem.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * Remove hidden elements (display:none or visibility:hidden)
 */
function removeHiddenElems(doc: Document): void {
  const allElements = doc.querySelectorAll('*');
  const toRemove: Element[] = [];

  for (const elem of allElements) {
    const display = elem.getAttribute('display');
    const visibility = elem.getAttribute('visibility');
    const style = elem.getAttribute('style');

    if (
      display === 'none' ||
      visibility === 'hidden' ||
      style?.includes('display:none') ||
      style?.includes('display: none')
    ) {
      toRemove.push(elem);
    }
  }

  for (const elem of toRemove) {
    elem.parentNode?.removeChild(elem);
  }
}

/**
 * Cleanup IDs - remove unused and shorten long IDs
 */
function cleanupIds(doc: Document): void {
  const allElements = doc.querySelectorAll('[id]');
  const usedIds = new Set<string>();

  // Find all ID references
  const allNodes = doc.querySelectorAll('*');
  for (const node of allNodes) {
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      // Check for url(#id), xlink:href="#id", href="#id"
      const matches = attr.value.match(/url\(#([^)]+)\)|#([^\s"']+)/g);
      if (matches) {
        for (const match of matches) {
          const id = match.replace(/url\(#|#|\)/g, '');
          usedIds.add(id);
        }
      }
    }
  }

  // Remove unused IDs
  for (const elem of allElements) {
    const id = elem.getAttribute('id');
    if (id && !usedIds.has(id)) {
      elem.removeAttribute('id');
    }
  }
}

/**
 * Convert colors to shorter formats
 */
function convertColors(doc: Document, options: boolean | { currentColor: boolean }): void {
  const convertCurrentColor = typeof options === 'object' ? options.currentColor : false;
  const allElements = doc.querySelectorAll('*');

  for (const elem of allElements) {
    // Convert fill and stroke attributes
    ['fill', 'stroke', 'stop-color'].forEach((attr) => {
      const value = elem.getAttribute(attr);
      if (value) {
        elem.setAttribute(attr, optimizeColor(value, convertCurrentColor));
      }
    });

    // Convert style attribute colors
    const style = elem.getAttribute('style');
    if (style) {
      const optimized = style.replace(
        /(fill|stroke|stop-color|color)\s*:\s*([^;]+)/g,
        (match, prop, color) => `${prop}:${optimizeColor(color.trim(), convertCurrentColor)}`
      );
      elem.setAttribute('style', optimized);
    }
  }
}

/**
 * Optimize a single color value
 */
function optimizeColor(color: string, convertCurrentColor: boolean): string {
  color = color.trim();

  // Convert rgb/rgba to hex
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    if (a && parseFloat(a) < 1) {
      return color; // Keep rgba for transparency
    }
    const hex = `#${Number(r).toString(16).padStart(2, '0')}${Number(g).toString(16).padStart(2, '0')}${Number(b).toString(16).padStart(2, '0')}`;
    return shortenHex(hex);
  }

  // Shorten hex colors
  if (color.startsWith('#')) {
    return shortenHex(color);
  }

  // Convert named colors to hex if shorter
  const namedColors: Record<string, string> = {
    white: '#fff',
    black: '#000',
    red: '#f00',
    blue: '#00f',
    green: '#008000',
    yellow: '#ff0',
    cyan: '#0ff',
    magenta: '#f0f',
  };

  const lowerColor = color.toLowerCase();
  if (namedColors[lowerColor]) {
    return namedColors[lowerColor] || color;
  }

  return color;
}

/**
 * Shorten hex color if possible (#aabbcc -> #abc)
 */
function shortenHex(hex: string): string {
  if (hex.length === 7) {
    const [, r1, r2, g1, g2, b1, b2] = hex;
    if (r1 === r2 && g1 === g2 && b1 === b2) {
      return `#${r1}${g1}${b1}`;
    }
  }
  return hex.toLowerCase();
}

/**
 * Round number to precision
 */
function roundToPrecision(num: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(num * factor) / factor;
}

/**
 * Optimize path data
 */
function convertPathData(doc: Document, options: boolean | { precision: number }): void {
  const precision = typeof options === 'object' ? options.precision : 3;
  const pathElements = doc.querySelectorAll('path');

  for (const path of pathElements) {
    const d = path.getAttribute('d');
    if (d) {
      const optimized = optimizePathData(d, precision);
      path.setAttribute('d', optimized);
    }
  }
}

/**
 * Optimize path data string
 */
function optimizePathData(d: string, precision: number): string {
  // Remove unnecessary whitespace
  d = d.replace(/\s+/g, ' ').trim();

  // Round numbers to precision
  d = d.replace(/[-+]?\d*\.?\d+/g, (match) => {
    const num = parseFloat(match);
    return roundToPrecision(num, precision).toString();
  });

  // Remove spaces around commands and commas
  d = d.replace(/\s*,\s*/g, ',');
  d = d.replace(/\s*([MLHVCSQTAZmlhvcsqtaz])\s*/g, '$1');

  // Remove leading zeros
  d = d.replace(/(?<=\s|,|^)0+(\d)/g, '$1');

  return d;
}

/**
 * Convert transform attributes
 */
function convertTransform(doc: Document): void {
  const allElements = doc.querySelectorAll('[transform]');

  for (const elem of allElements) {
    const transform = elem.getAttribute('transform');
    if (transform) {
      const optimized = optimizeTransform(transform);
      if (optimized === '') {
        elem.removeAttribute('transform');
      } else {
        elem.setAttribute('transform', optimized);
      }
    }
  }
}

/**
 * Optimize transform string
 */
function optimizeTransform(transform: string): string {
  // Remove identity transforms
  if (transform === 'matrix(1,0,0,1,0,0)' || transform === 'matrix(1 0 0 1 0 0)') {
    return '';
  }

  if (transform === 'translate(0,0)' || transform === 'translate(0)') {
    return '';
  }

  if (transform === 'scale(1,1)' || transform === 'scale(1)') {
    return '';
  }

  if (transform === 'rotate(0)') {
    return '';
  }

  // Normalize spacing
  return transform.replace(/\s+/g, ' ').trim();
}

/**
 * Remove useless stroke and fill
 */
function removeUselessStrokeAndFill(doc: Document): void {
  const allElements = doc.querySelectorAll('*');

  for (const elem of allElements) {
    const fill = elem.getAttribute('fill');
    const stroke = elem.getAttribute('stroke');

    // Remove fill="none" if stroke is present
    if (fill === 'none' && stroke && stroke !== 'none') {
      // Keep fill="none" - it's meaningful
    }

    // Remove stroke="none" if no stroke-width
    if (stroke === 'none' && !elem.getAttribute('stroke-width')) {
      elem.removeAttribute('stroke');
    }
  }
}

/**
 * Optimize SVG content
 *
 * Applies various optimization techniques to reduce SVG size while maintaining visual quality.
 *
 * @param svg - SVG string to optimize
 * @param config - Optimization configuration
 * @returns Optimized SVG string
 *
 * @example
 * ```typescript
 * const optimized = optimizeSVG(svgString, {
 *   removeComments: true,
 *   cleanupIds: true,
 *   convertColors: true,
 *   floatPrecision: 2,
 * });
 * ```
 */
export function optimizeSVG(svg: string, config?: SVGOptimizerConfig): string {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const doc = parseSVG(svg);

  // Apply optimizations
  if (mergedConfig.removeComments) removeComments(doc);
  if (mergedConfig.removeMetadata) removeMetadata(doc);
  if (mergedConfig.removeTitle) removeTitle(doc);
  if (mergedConfig.removeDesc) removeDesc(doc);
  if (mergedConfig.removeEditorsNSData) removeEditorsNSData(doc);
  if (mergedConfig.removeEmptyAttrs) removeEmptyAttrs(doc);
  if (mergedConfig.removeHiddenElems) removeHiddenElems(doc);
  if (mergedConfig.cleanupIds) cleanupIds(doc);
  if (mergedConfig.convertColors) convertColors(doc, mergedConfig.convertColors);
  if (mergedConfig.convertPathData) convertPathData(doc, mergedConfig.convertPathData);
  if (mergedConfig.convertTransform) convertTransform(doc);
  if (mergedConfig.removeUselessStrokeAndFill) removeUselessStrokeAndFill(doc);

  let result = serializeSVG(doc);

  // Final cleanup - remove extra whitespace
  result = result.replace(/>\s+</g, '><');

  return result;
}

/**
 * Compress SVG string to binary format
 *
 * Uses browser's CompressionStream API (gzip) for efficient compression.
 *
 * @param svg - SVG string to compress
 * @returns Compressed data as Uint8Array
 *
 * @example
 * ```typescript
 * const compressed = await compressSVG(svgString);
 * // Store compressed data
 * localStorage.setItem('icon', JSON.stringify(Array.from(compressed)));
 * ```
 */
export async function compressSVG(svg: string): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    // Fallback for environments without CompressionStream
    const encoder = new TextEncoder();
    return encoder.encode(svg);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(svg));
      controller.close();
    },
  });

  const compressed = stream.pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = compressed.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Decompress binary SVG data to string
 *
 * Uses browser's DecompressionStream API (gzip) for decompression.
 *
 * @param data - Compressed data as Uint8Array
 * @returns Decompressed SVG string
 *
 * @example
 * ```typescript
 * const data = new Uint8Array(JSON.parse(localStorage.getItem('icon')));
 * const svg = await decompressSVG(data);
 * ```
 */
export async function decompressSVG(data: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    // Fallback for environments without DecompressionStream
    const decoder = new TextDecoder();
    return decoder.decode(data);
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const decompressed = stream.pipeThrough(new DecompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = decompressed.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const decoder = new TextDecoder();
  return decoder.decode(combined);
}
