/**
 * Tests for SVG Sprite Generation and Extraction
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateSprite,
  extractFromSprite,
  loadSprite,
  clearSpriteCache,
  parseSpriteManifest,
  type SpriteGeneratorConfig,
} from '../../../src/svg/optimization/sprite.js';

describe('generateSprite', () => {
  it('should generate a basic sprite from icons', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'heart',
          content: '<path d="M12 21.35l-1.45-1.32"/>',
          viewBox: '0 0 24 24',
        },
        {
          id: 'star',
          content: '<path d="M12 17.27L18.18 21"/>',
          viewBox: '0 0 24 24',
        },
      ],
    };

    const result = generateSprite(config);

    expect(result.sprite).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(result.sprite).toContain('<symbol id="heart"');
    expect(result.sprite).toContain('<symbol id="star"');
    expect(result.sprite).toContain('viewBox="0 0 24 24"');

    expect(result.manifest).toHaveProperty('heart');
    expect(result.manifest).toHaveProperty('star');
    expect(result.manifest.heart.viewBox).toBe('0 0 24 24');
  });

  it('should apply symbol ID prefix', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'heart',
          content: '<path d="M12 21.35l-1.45-1.32"/>',
        },
      ],
      symbolIdPrefix: 'icon-',
    };

    const result = generateSprite(config);

    expect(result.sprite).toContain('id="icon-heart"');
    expect(result.manifest.heart.id).toBe('icon-heart');
  });

  it('should remove colors when removeColors is true', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'colored',
          content: '<path d="M0 0" fill="red" stroke="blue" color="green"/>',
        },
      ],
      removeColors: true,
    };

    const result = generateSprite(config);

    expect(result.sprite).not.toContain('fill="red"');
    expect(result.sprite).not.toContain('stroke="blue"');
    expect(result.sprite).not.toContain('color="green"');
  });

  it('should remove styles when removeStyles is true', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'styled',
          content: '<path d="M0 0" style="fill: red;"/><style>.foo { color: blue; }</style>',
        },
      ],
      removeStyles: true,
    };

    const result = generateSprite(config);

    // The sprite SVG itself has style="display:none" which is expected
    // Check that the icon content doesn't have styles
    const symbolContent = result.sprite.match(/<symbol[^>]*>(.*?)<\/symbol>/s)?.[1] || '';
    expect(symbolContent).not.toContain('style=');
    expect(result.sprite).not.toContain('<style>');
  });

  it('should remove IDs when removeIds is true', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'with-ids',
          content: '<path id="path1" d="M0 0"/><circle id="circle1" cx="10" cy="10"/>',
        },
      ],
      removeIds: true,
    };

    const result = generateSprite(config);

    expect(result.sprite).not.toContain('id="path1"');
    expect(result.sprite).not.toContain('id="circle1"');
    // But should still have the symbol ID
    expect(result.sprite).toContain('id="with-ids"');
  });

  it('should compress SVG when compress is true', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'icon',
          content: `
            <path d="M0 0" />
            <circle cx="10" cy="10" />
          `,
        },
      ],
      compress: true,
    };

    const result = generateSprite(config);

    // Compressed SVG should not have extra whitespace between tags
    expect(result.sprite).not.toMatch(/>\s+</);
  });

  it('should extract content from full SVG elements', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'full-svg',
          content: '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
        },
      ],
    };

    const result = generateSprite(config);

    // Should extract just the path, not the svg tags
    expect(result.sprite).toContain('<path d="M0 0"/>');
    expect(result.sprite).not.toContain('<svg viewBox="0 0 24 24">');
  });

  it('should remove duplicates when removeDuplicates is true', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'icon1',
          content: '<path d="M0 0"/>',
        },
        {
          id: 'icon2',
          content: '<path d="M0 0"/>',
        },
      ],
      removeDuplicates: true,
    };

    const result = generateSprite(config);

    // Should only have one symbol since content is identical
    const symbolCount = (result.sprite.match(/<symbol/g) || []).length;
    expect(symbolCount).toBe(1);
  });

  it('should parse viewBox from icon content', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'auto-viewbox',
          content: '<svg viewBox="0 0 16 16"><path d="M0 0"/></svg>',
        },
      ],
    };

    const result = generateSprite(config);

    expect(result.manifest['auto-viewbox'].viewBox).toBe('0 0 16 16');
  });

  it('should use default viewBox when not provided', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'no-viewbox',
          content: '<path d="M0 0"/>',
        },
      ],
      symbolDefaults: {
        viewBox: '0 0 32 32',
      },
    };

    const result = generateSprite(config);

    expect(result.manifest['no-viewbox'].viewBox).toBe('0 0 32 32');
  });

  it('should include width and height in manifest', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'sized',
          content: '<path d="M0 0"/>',
          viewBox: '0 0 100 50',
        },
      ],
    };

    const result = generateSprite(config);

    expect(result.manifest.sized.width).toBe(100);
    expect(result.manifest.sized.height).toBe(50);
  });

  it('should generate component code when format is component', () => {
    const config: SpriteGeneratorConfig = {
      icons: [
        {
          id: 'heart',
          content: '<path d="M0 0"/>',
        },
      ],
      format: 'component',
    };

    const result = generateSprite(config);

    expect(result.component).toBeDefined();
    expect(result.component).toContain('defineComponent');
    expect(result.component).toContain('export const manifest');
    expect(result.component).toContain('export const SpriteSheet');
  });
});

describe('parseSpriteManifest', () => {
  it('should parse sprite and extract manifest', () => {
    const spriteContent = `
      <svg>
        <symbol id="heart" viewBox="0 0 24 24"><path d="M0 0"/></symbol>
        <symbol id="star" viewBox="0 0 16 16"><path d="M0 0"/></symbol>
      </svg>
    `;

    const manifest = parseSpriteManifest(spriteContent);

    expect(manifest).toHaveProperty('heart');
    expect(manifest).toHaveProperty('star');
    expect(manifest.heart.viewBox).toBe('0 0 24 24');
    expect(manifest.star.viewBox).toBe('0 0 16 16');
    expect(manifest.heart.width).toBe(24);
    expect(manifest.heart.height).toBe(24);
  });

  it('should handle empty sprite', () => {
    const manifest = parseSpriteManifest('<svg></svg>');
    expect(Object.keys(manifest)).toHaveLength(0);
  });
});

describe('loadSprite', () => {
  beforeEach(() => {
    clearSpriteCache();
  });

  it('should load sprite from URL', async () => {
    const mockSprite = '<svg><symbol id="test"/></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    const sprite = await loadSprite('http://example.com/sprite.svg');

    expect(sprite).toBe(mockSprite);
    expect(global.fetch).toHaveBeenCalledWith('http://example.com/sprite.svg');
  });

  it('should cache sprites by default', async () => {
    const mockSprite = '<svg><symbol id="test"/></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    await loadSprite('http://example.com/sprite.svg', true);
    await loadSprite('http://example.com/sprite.svg', true);

    // Should only fetch once due to caching
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should not cache when cache is false', async () => {
    const mockSprite = '<svg><symbol id="test"/></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    await loadSprite('http://example.com/sprite.svg', false);
    await loadSprite('http://example.com/sprite.svg', false);

    // Should fetch twice without caching
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should throw error when fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    } as Response);

    await expect(loadSprite('http://example.com/sprite.svg')).rejects.toThrow(
      'Failed to load sprite from http://example.com/sprite.svg'
    );
  });
});

describe('extractFromSprite', () => {
  it('should extract icon from sprite URL', async () => {
    const mockSprite = `
      <svg>
        <symbol id="heart" viewBox="0 0 24 24">
          <path d="M12 21.35l-1.45-1.32"/>
        </symbol>
      </svg>
    `;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    global.DOMParser = class {
      parseFromString(str: string) {
        // Mock implementation
        return {
          querySelector: (selector: string) => {
            if (selector === 'symbol[id="heart"]') {
              return {
                innerHTML: '<path d="M12 21.35l-1.45-1.32"/>',
                getAttribute: (attr: string) => (attr === 'viewBox' ? '0 0 24 24' : null),
              };
            }
            return null;
          },
        };
      }
    } as any;

    const icon = await extractFromSprite('http://example.com/sprite.svg', 'heart');

    expect(icon).not.toBeNull();
    expect(icon?.id).toBe('heart');
    expect(icon?.content).toContain('path');
    expect(icon?.viewBox).toBe('0 0 24 24');
  });

  it('should return null when icon not found', async () => {
    const mockSprite = '<svg></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    global.DOMParser = class {
      parseFromString() {
        return {
          querySelector: () => null,
        };
      }
    } as any;

    const icon = await extractFromSprite('http://example.com/sprite.svg', 'nonexistent');

    expect(icon).toBeNull();
  });

  it('should handle fetch errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const icon = await extractFromSprite('http://example.com/sprite.svg', 'heart');

    expect(icon).toBeNull();
  });
});

describe('clearSpriteCache', () => {
  beforeEach(() => {
    clearSpriteCache();
  });

  it('should clear specific sprite from cache', async () => {
    const mockSprite = '<svg><symbol id="test"/></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    const url = 'http://example.com/sprite.svg';

    // Load and cache
    await loadSprite(url, true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Clear cache
    clearSpriteCache(url);

    // Load again - should fetch again
    await loadSprite(url, true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should clear all sprites when no URL provided', async () => {
    const mockSprite = '<svg><symbol id="test"/></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    // Load multiple sprites
    await loadSprite('http://example.com/sprite1.svg', true);
    await loadSprite('http://example.com/sprite2.svg', true);

    // Clear all
    clearSpriteCache();

    // Load again - should fetch again
    await loadSprite('http://example.com/sprite1.svg', true);
    await loadSprite('http://example.com/sprite2.svg', true);

    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
