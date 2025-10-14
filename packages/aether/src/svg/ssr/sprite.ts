/**
 * Static Sprite Generation for SSR
 *
 * Generate optimized SVG sprite sheets for server-side rendering
 */

import { minifySVG, escapeHtml } from './utils.js';
import type { IconDefinition } from '../icons/IconRegistry.js';

export interface SpriteConfig {
  /** Remove fill colors to allow CSS styling (default: false) */
  removeColors?: boolean;

  /** Remove style elements (default: false) */
  removeStyles?: boolean;

  /** Clean up and normalize IDs (default: true) */
  cleanupIds?: boolean;

  /** Remove duplicate content (default: true) */
  removeDuplicates?: boolean;

  /** Compress/minify output (default: true) */
  compress?: boolean;

  /** Symbol ID prefix (default: 'icon-') */
  symbolIdPrefix?: string;

  /** Default viewBox for symbols without one (default: '0 0 24 24') */
  defaultViewBox?: string;

  /** Default preserveAspectRatio (default: 'xMidYMid meet') */
  defaultPreserveAspectRatio?: string;
}

export interface SpriteManifest {
  /** Icon ID in sprite */
  id: string;

  /** ViewBox dimensions */
  viewBox: string;

  /** Original icon name */
  name: string;

  /** Metadata */
  metadata?: Record<string, any>;
}

export interface GeneratedSprite {
  /** SVG sprite string */
  sprite: string;

  /** Manifest of all icons in sprite */
  manifest: Record<string, SpriteManifest>;

  /** Total number of icons */
  count: number;

  /** Size in bytes */
  size: number;
}

/**
 * Generate a static SVG sprite sheet from icon definitions
 */
export function generateStaticSprite(
  iconNames: string[],
  iconData: Record<string, IconDefinition>,
  config: SpriteConfig = {}
): GeneratedSprite {
  const {
    removeColors = false,
    removeStyles = false,
    cleanupIds: shouldCleanupIds = true,
    removeDuplicates = true,
    compress = true,
    symbolIdPrefix = 'icon-',
    defaultViewBox = '0 0 24 24',
    defaultPreserveAspectRatio = 'xMidYMid meet',
  } = config;

  const symbols: string[] = [];
  const manifest: Record<string, SpriteManifest> = {};
  const seenContent = new Set<string>();

  // Process each icon
  for (const iconName of iconNames) {
    const icon = iconData[iconName];
    if (!icon) {
      console.warn(`Icon "${iconName}" not found, skipping`);
      continue;
    }

    // Get icon content
    let content = icon.content || icon.path || '';
    if (!content) {
      console.warn(`Icon "${iconName}" has no content, skipping`);
      continue;
    }

    // Check for duplicates
    if (removeDuplicates && seenContent.has(content)) {
      continue;
    }
    seenContent.add(content);

    // Process content
    content = processIconContent(content, {
      removeColors,
      removeStyles,
      cleanupIds: shouldCleanupIds,
    });

    // Generate symbol ID
    const symbolId = `${symbolIdPrefix}${iconName}`;

    // Get viewBox
    const viewBox = icon.viewBox || extractViewBox(content) || defaultViewBox;

    // Create symbol element
    const symbol = createSymbol(symbolId, viewBox, content, defaultPreserveAspectRatio);
    symbols.push(symbol);

    // Add to manifest
    manifest[iconName] = {
      id: symbolId,
      viewBox,
      name: iconName,
      metadata: icon.metadata,
    };
  }

  // Build sprite SVG
  let sprite = buildSpriteSVG(symbols);

  // Compress if requested
  if (compress) {
    sprite = minifySVG(sprite);
  }

  return {
    sprite,
    manifest,
    count: symbols.length,
    size: new TextEncoder().encode(sprite).length,
  };
}

/**
 * Process icon content with optimizations
 */
function processIconContent(
  content: string,
  options: {
    removeColors?: boolean;
    removeStyles?: boolean;
    cleanupIds?: boolean;
  }
): string {
  let processed = content;

  // Remove colors
  if (options.removeColors) {
    processed = processed
      .replace(/fill="[^"]*"/g, 'fill="currentColor"')
      .replace(/stroke="[^"]*"/g, 'stroke="currentColor"');
  }

  // Remove style elements
  if (options.removeStyles) {
    processed = processed.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  }

  // Cleanup IDs
  if (options.cleanupIds) {
    processed = cleanupIds(processed);
  }

  // Remove SVG wrapper if present
  processed = processed.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

  return processed.trim();
}

/**
 * Clean up and normalize IDs in SVG content
 */
function cleanupIds(content: string): string {
  const idMap = new Map<string, string>();
  let idCounter = 0;

  return content.replace(/id="([^"]*)"/g, (match, id) => {
    if (!idMap.has(id)) {
      idMap.set(id, `id${idCounter++}`);
    }
    return `id="${idMap.get(id)}"`;
  }).replace(/url\(#([^)]*)\)/g, (match, id) => `url(#${idMap.get(id) || id})`);
}

/**
 * Extract viewBox from SVG content
 */
function extractViewBox(content: string): string | null {
  const match = content.match(/viewBox="([^"]*)"/);
  return match?.[1] ?? null;
}

/**
 * Create a symbol element
 */
function createSymbol(
  id: string,
  viewBox: string,
  content: string,
  preserveAspectRatio: string
): string {
  return `<symbol id="${escapeHtml(id)}" viewBox="${escapeHtml(viewBox)}" preserveAspectRatio="${escapeHtml(preserveAspectRatio)}">${content}</symbol>`;
}

/**
 * Build complete sprite SVG
 */
function buildSpriteSVG(symbols: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="display: none;">${symbols.join('')}</svg>`;
}

/**
 * Generate sprite from icon registry
 */
export async function generateSpriteFromRegistry(
  iconNames: string[],
  registryGetter: () => { get: (name: string) => Promise<IconDefinition | null> },
  config: SpriteConfig = {}
): Promise<GeneratedSprite> {
  const registry = registryGetter();
  const iconData: Record<string, IconDefinition> = {};

  // Fetch all icons
  await Promise.all(
    iconNames.map(async name => {
      const icon = await registry.get(name);
      if (icon) {
        iconData[name] = icon;
      }
    })
  );

  return generateStaticSprite(iconNames, iconData, config);
}

/**
 * Split large sprite into multiple smaller sprites
 */
export function splitSprite(
  iconNames: string[],
  iconData: Record<string, IconDefinition>,
  maxIconsPerSprite: number = 50,
  config: SpriteConfig = {}
): GeneratedSprite[] {
  const sprites: GeneratedSprite[] = [];

  for (let i = 0; i < iconNames.length; i += maxIconsPerSprite) {
    const chunk = iconNames.slice(i, i + maxIconsPerSprite);
    const sprite = generateStaticSprite(chunk, iconData, config);
    sprites.push(sprite);
  }

  return sprites;
}

/**
 * Generate inline sprite for critical icons
 */
export function generateInlineSprite(
  iconNames: string[],
  iconData: Record<string, IconDefinition>,
  config: SpriteConfig = {}
): string {
  const sprite = generateStaticSprite(iconNames, iconData, {
    ...config,
    compress: true,
  });

  return sprite.sprite;
}

/**
 * Generate sprite preload links
 */
export function generateSpritePreloadLinks(spriteUrls: string[]): string {
  return spriteUrls
    .map(url => `<link rel="preload" as="image" type="image/svg+xml" href="${escapeHtml(url)}" crossorigin="anonymous">`)
    .join('\n');
}

/**
 * Create a sprite reference for use in SVG elements
 */
export function createSpriteReference(spriteUrl: string, iconId: string): string {
  return `${spriteUrl}#${iconId}`;
}

/**
 * Generate usage example for an icon in sprite
 */
export function generateSpriteUsageExample(
  iconName: string,
  manifest: SpriteManifest,
  spriteUrl: string = '/sprites.svg'
): string {
  return `<svg width="24" height="24" viewBox="${manifest.viewBox}">
  <use href="${spriteUrl}#${manifest.id}" />
</svg>`;
}
