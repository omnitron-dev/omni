/**
 * SVG Sprite Generation and Extraction
 *
 * Utilities for generating optimized SVG sprites and extracting icons from them
 */

import type { IconDefinition } from '../icons/IconRegistry.js';

export interface SpriteGeneratorConfig {
  // Input
  icons: Array<{ id: string; content: string; viewBox?: string }>;

  // Optimization
  removeColors?: boolean;
  removeStyles?: boolean;
  removeIds?: boolean;
  removeDuplicates?: boolean;
  deduplicatePaths?: boolean; // Deduplicate identical paths
  extractColors?: boolean; // Extract and create color variants
  simplifyPaths?: boolean; // Simplify path data
  mergePaths?: boolean; // Merge adjacent paths

  // Output
  format?: 'inline' | 'external' | 'component';
  compress?: boolean;

  // Symbol configuration
  symbolIdPrefix?: string;
  symbolDefaults?: {
    viewBox?: string;
    preserveAspectRatio?: string;
  };
}

export interface SpriteManifest {
  [iconId: string]: {
    id: string;
    viewBox: string;
    width?: number;
    height?: number;
  };
}

export interface GeneratedSprite {
  sprite: string;
  manifest: SpriteManifest;
  component?: string;
}

/**
 * Generate an optimized SVG sprite from icon definitions
 */
export function generateSprite(config: SpriteGeneratorConfig): GeneratedSprite {
  const {
    icons,
    removeColors = false,
    removeStyles = false,
    removeIds = true,
    removeDuplicates = true,
    deduplicatePaths = false,
    extractColors = false,
    simplifyPaths = false,
    mergePaths = false,
    symbolIdPrefix = '',
    symbolDefaults = {},
    compress = false,
  } = config;

  const manifest: SpriteManifest = {};
  const symbols: string[] = [];
  const seenContent = new Set<string>();
  const pathCache = new Map<string, string>();

  for (const icon of icons) {
    let content = icon.content;

    // Skip duplicates if enabled
    if (removeDuplicates && seenContent.has(content)) {
      continue;
    }

    // Extract content from SVG if it's a full SVG element
    if (content.includes('<svg')) {
      content = extractSVGContent(content);
    }

    // Apply optimizations
    if (removeColors) {
      content = stripColors(content);
    }

    if (removeStyles) {
      content = stripStyles(content);
    }

    if (removeIds) {
      content = stripIds(content);
    }

    // Advanced optimizations
    if (deduplicatePaths) {
      content = deduplicatePathsInContent(content, pathCache);
    }

    if (simplifyPaths) {
      content = simplifyPathsInContent(content);
    }

    if (mergePaths) {
      content = mergePathsInContent(content);
    }

    if (extractColors) {
      content = extractColorsFromContent(content);
    }

    // Extract viewBox
    const viewBox = icon.viewBox || extractViewBox(icon.content) || symbolDefaults.viewBox || '0 0 24 24';

    // Parse dimensions from viewBox
    const viewBoxParts = viewBox.split(' ');
    const width = viewBoxParts[2] ? parseFloat(viewBoxParts[2]) : undefined;
    const height = viewBoxParts[3] ? parseFloat(viewBoxParts[3]) : undefined;

    // Generate symbol ID
    const symbolId = symbolIdPrefix ? `${symbolIdPrefix}${icon.id}` : icon.id;

    // Create symbol element
    const preserveAspectRatio = symbolDefaults.preserveAspectRatio || 'xMidYMid meet';
    const symbol = `<symbol id="${symbolId}" viewBox="${viewBox}" preserveAspectRatio="${preserveAspectRatio}">${content}</symbol>`;

    symbols.push(symbol);
    seenContent.add(content);

    // Add to manifest
    manifest[icon.id] = {
      id: symbolId,
      viewBox,
      width,
      height,
    };
  }

  // Generate sprite SVG
  let sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>`;

  // Compress if needed
  if (compress) {
    sprite = compressSVG(sprite);
  }

  // Generate component if needed
  let component: string | undefined;
  if (config.format === 'component') {
    component = generateSpriteComponent(sprite, manifest);
  }

  return {
    sprite,
    manifest,
    component,
  };
}

/**
 * Extract an icon from an external sprite
 */
export async function extractFromSprite(spriteUrl: string, iconId: string): Promise<IconDefinition | null> {
  try {
    const response = await fetch(spriteUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch sprite from ${spriteUrl}`);
    }

    const spriteContent = await response.text();

    // Parse sprite using DOMParser
    if (typeof DOMParser === 'undefined') {
      // Server-side environment
      return extractFromSpriteString(spriteContent, iconId);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(spriteContent, 'image/svg+xml');

    // Find symbol by ID
    const symbol = doc.querySelector(`symbol[id="${iconId}"]`);
    if (!symbol) {
      return null;
    }

    // Extract symbol content
    const content = symbol.innerHTML;
    const viewBox = symbol.getAttribute('viewBox') || undefined;

    return {
      id: iconId,
      content,
      viewBox,
    };
  } catch (error) {
    console.error(`Failed to extract icon "${iconId}" from sprite:`, error);
    return null;
  }
}

/**
 * Extract icon from sprite string (for SSR)
 */
function extractFromSpriteString(spriteContent: string, iconId: string): IconDefinition | null {
  // Use regex to find the symbol
  const symbolRegex = new RegExp(`<symbol[^>]*id="${iconId}"[^>]*>([\\s\\S]*?)</symbol>`, 'i');
  const match = spriteContent.match(symbolRegex);

  if (!match) {
    return null;
  }

  const content = match[1];
  const viewBoxMatch = match[0].match(/viewBox="([^"]+)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : undefined;

  return {
    id: iconId,
    content,
    viewBox,
  };
}

/**
 * Extract SVG content from a full SVG element
 */
function extractSVGContent(svg: string): string {
  // Remove svg tags and extract inner content
  const match = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  return match && match[1] ? match[1].trim() : svg;
}

/**
 * Extract viewBox from SVG string
 */
function extractViewBox(svg: string): string | null {
  const match = svg.match(/viewBox="([^"]+)"/i);
  return match && match[1] ? match[1] : null;
}

/**
 * Strip color attributes from SVG content
 */
function stripColors(content: string): string {
  return content
    .replace(/\s+fill="[^"]*"/gi, '')
    .replace(/\s+stroke="[^"]*"/gi, '')
    .replace(/\s+color="[^"]*"/gi, '')
    .replace(/\s+fill:\s*[^;"]*/gi, '')
    .replace(/\s+stroke:\s*[^;"]*/gi, '')
    .replace(/\s+color:\s*[^;"]*/gi, '');
}

/**
 * Strip style attributes and elements from SVG content
 */
function stripStyles(content: string): string {
  return content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/\s+style="[^"]*"/gi, '');
}

/**
 * Strip ID attributes from SVG content
 */
function stripIds(content: string): string {
  return content.replace(/\s+id="[^"]*"/gi, '');
}

/**
 * Compress SVG by removing unnecessary whitespace
 */
function compressSVG(svg: string): string {
  return (
    svg
      // Remove comments
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove whitespace between tags
      .replace(/>\s+</g, '><')
      // Remove leading/trailing whitespace
      .trim()
      // Remove extra spaces in attributes
      .replace(/\s+/g, ' ')
  );
}

/**
 * Generate a React/Aether component for the sprite
 */
function generateSpriteComponent(sprite: string, manifest: SpriteManifest): string {
  const manifestJson = JSON.stringify(manifest, null, 2);

  return `
import { defineComponent } from '@omnitron-dev/aether';

export const manifest = ${manifestJson};

export const SpriteSheet = defineComponent(() => {
  return () => \`${sprite.replace(/`/g, '\\`')}\`;
});
`.trim();
}

/**
 * Load sprite from URL and cache it
 */
const spriteCache = new Map<string, Promise<string>>();

export async function loadSprite(url: string, cache: boolean = true): Promise<string> {
  if (cache && spriteCache.has(url)) {
    return spriteCache.get(url)!;
  }

  const loadPromise = fetch(url).then((res) => {
    if (!res.ok) {
      throw new Error(`Failed to load sprite from ${url}`);
    }
    return res.text();
  });

  if (cache) {
    spriteCache.set(url, loadPromise);
  }

  return loadPromise;
}

/**
 * Clear sprite cache
 */
export function clearSpriteCache(url?: string): void {
  if (url) {
    spriteCache.delete(url);
  } else {
    spriteCache.clear();
  }
}

/**
 * Parse sprite and extract all icon IDs
 */
export function parseSpriteManifest(spriteContent: string): SpriteManifest {
  const manifest: SpriteManifest = {};

  // Use regex to find all symbols
  const symbolRegex = /<symbol[^>]*id="([^"]+)"[^>]*viewBox="([^"]*)"[^>]*>/gi;
  let match;

  while ((match = symbolRegex.exec(spriteContent)) !== null) {
    const id = match[1];
    const viewBox = match[2];

    if (!id || !viewBox) continue;

    const viewBoxParts = viewBox.split(' ');

    manifest[id] = {
      id,
      viewBox,
      width: viewBoxParts[2] ? parseFloat(viewBoxParts[2]) : undefined,
      height: viewBoxParts[3] ? parseFloat(viewBoxParts[3]) : undefined,
    };
  }

  return manifest;
}

/**
 * Advanced Optimization Functions
 */

/**
 * Deduplicate identical paths in content
 */
function deduplicatePathsInContent(content: string, pathCache: Map<string, string>): string {
  const pathRegex = /<path[^>]*d="([^"]+)"[^>]*>/gi;
  let nextId = pathCache.size;

  return content.replace(pathRegex, (match, pathData) => {
    if (!pathData) return match;

    // Check if we've seen this path before
    if (pathCache.has(pathData)) {
      const refId = pathCache.get(pathData);
      if (!refId) return match;
      // Replace with use reference
      return `<use href="#path-${refId}" />`;
    }

    // New unique path - add to cache
    const id = `path-${nextId++}`;
    pathCache.set(pathData, id);
    return match;
  });
}

/**
 * Simplify path data in content
 */
function simplifyPathsInContent(content: string): string {
  const pathRegex = /<path([^>]*d=")([^"]+)("[^>]*>)/gi;

  return content.replace(pathRegex, (match, before, pathData, after) => {
    const simplified = simplifyPathData(pathData);
    return `${before}${simplified}${after}`;
  });
}

/**
 * Simplify path data string
 */
function simplifyPathData(d: string): string {
  // Remove unnecessary spaces
  d = d.replace(/\s+/g, ' ').trim();

  // Remove spaces around commands
  d = d.replace(/\s*([MLHVCSQTAZmlhvcsqtaz])\s*/g, '$1');

  // Remove spaces around commas
  d = d.replace(/\s*,\s*/g, ',');

  // Convert absolute to relative when beneficial
  // This is a simplified version - full implementation would need path parsing
  d = d.replace(/([MLHVCSQTAZmlhvcsqtaz])\s*-/g, '$1-');

  return d;
}

/**
 * Merge adjacent paths in content
 */
function mergePathsInContent(content: string): string {
  // This is a simplified implementation
  // Full implementation would parse paths and merge when possible
  return content.replace(/<\/path>\s*<path([^>]*)>/gi, (match, attrs) => {
    // Only merge if no special attributes
    if (attrs.includes('fill') || attrs.includes('stroke')) {
      return match;
    }
    return ' '; // Merge paths by removing separator
  });
}

/**
 * Extract colors from content and replace with currentColor
 */
function extractColorsFromContent(content: string): string {
  // Find all unique colors
  const colors = new Set<string>();
  const colorRegex = /(fill|stroke)="(#[0-9a-fA-F]{3,6}|rgb[^"]+)"/gi;
  let match;

  while ((match = colorRegex.exec(content)) !== null) {
    if (match[2]) {
      colors.add(match[2]);
    }
  }

  // If only one color, replace with currentColor
  if (colors.size === 1) {
    return content.replace(colorRegex, '$1="currentColor"');
  }

  // For multiple colors, keep them but add data attributes for easy manipulation
  return content;
}
