/**
 * Icon Registry
 *
 * Centralized icon management system
 */

import { signal } from '../../index.js';

export interface IconDefinition {
  id?: string;
  path?: string;
  content?: string;
  viewBox?: string;
  width?: number;
  height?: number;
  metadata?: Record<string, any>;
}

export interface IconSource {
  name: string;
  type: 'url' | 'sprite' | 'component' | 'inline';
  source: string | IconSet;
  prefix?: string;
  lazy?: boolean;
}

export interface IconSet {
  [name: string]: string | IconDefinition;
}

export interface IconTransformer {
  name: string;
  transform: (icon: IconDefinition) => IconDefinition;
}

/**
 * Icon Registry for managing and accessing icons
 */
export class IconRegistry {
  private icons = new Map<string, IconDefinition>();
  private sources = new Map<string, IconSource>();
  private transformers: IconTransformer[] = [];
  private loading = new Map<string, Promise<IconDefinition>>();
  private iconsSignal = signal(0);

  /**
   * Register an icon source
   */
  register(source: IconSource): void {
    this.sources.set(source.name, source);

    // If inline icons, register them immediately
    if (source.type === 'inline' && typeof source.source === 'object') {
      this.registerSet(source.name, source.source as IconSet, source.prefix);
    }
  }

  /**
   * Register an icon set
   */
  registerSet(name: string, icons: IconSet, prefix?: string): void {
    for (const [iconName, iconData] of Object.entries(icons)) {
      const fullName = prefix ? `${prefix}:${iconName}` : iconName;
      const definition: IconDefinition = typeof iconData === 'string'
        ? { path: iconData }
        : iconData;

      this.icons.set(fullName, definition);
    }
    this.iconsSignal.set(this.icons.size);
  }

  /**
   * Get an icon definition
   */
  async get(name: string): Promise<IconDefinition | null> {
    // Check if already loaded
    if (this.icons.has(name)) {
      let icon = this.icons.get(name)!;
      // Apply transformers
      for (const transformer of this.transformers) {
        icon = transformer.transform(icon);
      }
      return icon;
    }

    // Check if currently loading
    if (this.loading.has(name)) {
      return this.loading.get(name)!;
    }

    // Try to load from sources
    for (const source of this.sources.values()) {
      if (source.prefix && !name.startsWith(source.prefix)) {
        continue;
      }

      if (source.type === 'url') {
        const loadPromise = this.loadFromUrl(name, source.source as string);
        this.loading.set(name, loadPromise);

        try {
          const icon = await loadPromise;
          this.icons.set(name, icon);
          this.loading.delete(name);
          this.iconsSignal.set(this.icons.size);
          return icon;
        } catch (error) {
          this.loading.delete(name);
          console.error(`Failed to load icon "${name}":`, error);
        }
      } else if (source.type === 'sprite') {
        const icon = await this.loadFromSprite(name, source.source as string);
        if (icon) {
          this.icons.set(name, icon);
          this.iconsSignal.set(this.icons.size);
          return icon;
        }
      }
    }

    return null;
  }

  /**
   * Check if an icon exists
   */
  has(name: string): boolean {
    return this.icons.has(name);
  }

  /**
   * List all available icon names
   */
  list(): string[] {
    return Array.from(this.icons.keys());
  }

  /**
   * Preload icons
   */
  async preload(names: string[]): Promise<void> {
    await Promise.all(names.map(name => this.get(name)));
  }

  /**
   * Clear all registered icons
   */
  clear(): void {
    this.icons.clear();
    this.sources.clear();
    this.loading.clear();
    this.iconsSignal.set(0);
  }

  /**
   * Add a transformer
   */
  addTransformer(transformer: IconTransformer): void {
    this.transformers.push(transformer);
  }

  /**
   * Remove a transformer
   */
  removeTransformer(name: string): void {
    this.transformers = this.transformers.filter(t => t.name !== name);
  }

  /**
   * Get registry statistics
   */
  getStats() {
    return {
      totalIcons: this.icons.size,
      sources: this.sources.size,
      loading: this.loading.size,
      transformers: this.transformers.length,
    };
  }

  /**
   * Load icon from URL
   */
  private async loadFromUrl(name: string, url: string): Promise<IconDefinition> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch icon from ${url}`);
    }

    const svg = await response.text();

    // Extract viewBox and path from SVG
    const viewBoxMatch = svg.match(/viewBox="([^"]+)"/);
    const pathMatch = svg.match(/<path[^>]*\sd="([^"]+)"/);

    return {
      content: svg,
      path: pathMatch ? pathMatch[1] : undefined,
      viewBox: viewBoxMatch ? viewBoxMatch[1] : undefined,
    };
  }

  /**
   * Load icon from sprite
   */
  private async loadFromSprite(name: string, spriteUrl: string): Promise<IconDefinition | null> {
    // This would extract the icon from an SVG sprite
    // Implementation depends on sprite format
    const response = await fetch(spriteUrl);
    if (!response.ok) {
      return null;
    }

    const sprite = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(sprite, 'image/svg+xml');

    const symbol = doc.querySelector(`#${name}`);
    if (!symbol) {
      return null;
    }

    return {
      content: symbol.outerHTML,
      viewBox: symbol.getAttribute('viewBox') || undefined,
    };
  }
}

// Global registry instance
let globalRegistry: IconRegistry | null = null;

/**
 * Get the global icon registry
 */
export function getIconRegistry(): IconRegistry {
  if (!globalRegistry) {
    globalRegistry = new IconRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (mainly for testing)
 */
export function resetIconRegistry(): void {
  globalRegistry = null;
}