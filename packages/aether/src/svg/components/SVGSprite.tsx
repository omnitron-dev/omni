/**
 * SVGSprite Component
 *
 * Component for rendering optimized SVG sprites with caching and lazy loading
 */

import { defineComponent, signal, effect, onCleanup } from '../../index.js';
import type { IconDefinition } from '../icons/IconRegistry.js';
import { generateSprite, loadSprite, parseSpriteManifest, type SpriteGeneratorConfig } from '../optimization/sprite.js';

export interface SVGSpriteProps {
  // Sprite configuration
  url?: string; // External sprite URL
  inline?: boolean; // Inline sprite in HTML
  icons?: IconDefinition[]; // Icons to include

  // Optimization
  compress?: boolean;
  removeColors?: boolean; // For monochrome icons
  removeIds?: boolean; // Clean up IDs

  // Loading
  preload?: boolean | string[]; // Preload specific icons
  lazy?: boolean;

  // Cache
  cache?: boolean | CacheConfig;

  // Events
  onLoad?: () => void;
  onError?: (e: Error) => void;
}

export interface CacheConfig {
  enabled?: boolean;
  maxAge?: number; // TTL in milliseconds
  storage?: 'memory' | 'session' | 'local';
}

/**
 * SVGSprite component for rendering sprite sheets
 */
export const SVGSprite = defineComponent<SVGSpriteProps>((props) => {
  const spriteContent = signal<string | null>(null);
  const isLoaded = signal(false);
  const error = signal<Error | null>(null);
  const _spriteId = signal<string>(`sprite-${generateId()}`);

  // Load sprite
  effect(() => {
    const loadAsync = async () => {
      try {
        let content: string | null = null;

        // Load from URL
        if (props.url) {
          const shouldCache = props.cache !== false;
          content = await loadSprite(props.url, shouldCache);
        }
        // Generate from icons
        else if (props.icons && props.icons.length > 0) {
          const config: SpriteGeneratorConfig = {
            icons: props.icons.map((icon) => ({
              id: icon.id || '',
              content: icon.content || icon.path || '',
              viewBox: icon.viewBox,
            })),
            compress: props.compress,
            removeColors: props.removeColors,
            removeIds: props.removeIds,
            format: props.inline ? 'inline' : 'external',
          };

          const result = generateSprite(config);
          content = result.sprite;
        }

        if (content) {
          spriteContent.set(content);
          isLoaded.set(true);
          props.onLoad?.();

          // Handle preloading
          if (props.preload) {
            if (Array.isArray(props.preload)) {
              // Preload specific icons
              preloadIcons(content, props.preload);
            } else if (props.preload === true) {
              // Preload all icons
              const manifest = parseSpriteManifest(content);
              preloadIcons(content, Object.keys(manifest));
            }
          }
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        props.onError?.(err);
      }
    };

    loadAsync();
  });

  // Cleanup on unmount
  onCleanup(() => {
    // Clear any cached data if needed
    if (props.cache === false && props.url) {
      // Could implement cache clearing logic here
    }
  });

  return () => {
    const content = spriteContent();

    if (error()) {
      // Don't render anything on error
      return null;
    }

    if (!isLoaded() || !content) {
      // Loading state - don't render anything
      return null;
    }

    // Render sprite inline in the document
    if (props.inline !== false) {
      // Insert sprite into DOM
      // The sprite will be hidden and used via <use> elements
      return <div dangerouslySetInnerHTML={{ __html: content }} style={{ display: 'none' }} />;
    }

    return null;
  };
});

/**
 * Preload icons by creating image elements
 */
function preloadIcons(spriteContent: string, iconIds: string[]): void {
  if (typeof document === 'undefined') return;

  // Create a temporary div to hold the sprite
  const div = document.createElement('div');
  div.innerHTML = spriteContent;
  div.style.display = 'none';
  document.body.appendChild(div);

  // The icons are now available for use
  // Additional preloading logic could be added here if needed

  // Clean up
  setTimeout(() => {
    document.body.removeChild(div);
  }, 0);
}

/**
 * Generate a unique ID for the sprite
 */
let idCounter = 0;
function generateId(): string {
  return `${Date.now()}-${++idCounter}`;
}

/**
 * Hook to use sprite in components
 */
export function useSpriteIcon(spriteId: string, iconId: string) {
  return `${spriteId}#${iconId}`;
}

/**
 * Component for rendering an icon from a sprite
 */
export interface SpriteIconProps {
  spriteId: string;
  iconId: string;
  size?: number | string;
  color?: string;
  className?: string;
  style?: any;
  title?: string;
  role?: string;
  'aria-label'?: string;
}

export const SpriteIcon = defineComponent<SpriteIconProps>((props) => () => {
  const size = props.size || 24;
  const href = `#${props.iconId}`;

  const svgProps: any = {
    width: size,
    height: size,
    className: props.className,
    style: props.style,
    role: props.role || 'img',
    'aria-label': props['aria-label'],
  };

  return (
    <svg {...svgProps}>
      {props.title && <title>{props.title}</title>}
      <use href={href} fill={props.color || 'currentColor'} />
    </svg>
  );
});
