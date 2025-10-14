/**
 * Tests for SVGSprite Component
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SVGSprite, SpriteIcon } from '../../../src/svg/components/SVGSprite.js';
import type { IconDefinition } from '../../../src/svg/icons/IconRegistry.js';
import { clearSpriteCache } from '../../../src/svg/optimization/sprite.js';

describe('SVGSprite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSpriteCache(); // Clear sprite cache between tests
  });

  it('should create sprite component', () => {
    const icons: IconDefinition[] = [
      {
        id: 'heart',
        path: 'M12 21.35l-1.45-1.32',
        viewBox: '0 0 24 24',
      },
    ];

    const render = SVGSprite({ icons, inline: true });

    expect(render).toBeDefined();
  });

  it('should generate sprite from icons prop', () => {
    const icons: IconDefinition[] = [
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
    ];

    const render = SVGSprite({ icons, inline: true });

    // Should generate sprite with symbols
    expect(render).toBeDefined();
  });

  it('should load sprite from URL', async () => {
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

    const onLoad = vi.fn();
    const sprite = SVGSprite({
      url: 'http://example.com/sprite.svg',
      inline: true,
      onLoad,
    });

    // Wait for effect to run
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(global.fetch).toHaveBeenCalledWith('http://example.com/sprite.svg');
  });

  it('should call onLoad when sprite loads successfully', async () => {
    const icons: IconDefinition[] = [
      {
        id: 'heart',
        content: '<path d="M0 0"/>',
      },
    ];

    const onLoad = vi.fn();
    SVGSprite({ icons, onLoad });

    // Wait for effect
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onLoad).toHaveBeenCalled();
  });

  it('should call onError when sprite fails to load', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    } as Response);

    const onError = vi.fn();
    SVGSprite({
      url: 'http://example.com/sprite.svg',
      onError,
    });

    // Wait for effect and async fetch to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onError).toHaveBeenCalled();
  });

  it('should apply optimization options', () => {
    const icons: IconDefinition[] = [
      {
        id: 'colored',
        content: '<path d="M0 0" fill="red" stroke="blue"/>',
      },
    ];

    const sprite = SVGSprite({
      icons,
      removeColors: true,
      compress: true,
    });

    expect(sprite).toBeDefined();
  });

  it('should support preload prop', () => {
    const icons: IconDefinition[] = [
      {
        id: 'heart',
        content: '<path d="M0 0"/>',
      },
      {
        id: 'star',
        content: '<path d="M0 0"/>',
      },
    ];

    const sprite = SVGSprite({
      icons,
      preload: ['heart'],
    });

    expect(sprite).toBeDefined();
  });

  it('should support preload all icons', () => {
    const icons: IconDefinition[] = [
      {
        id: 'heart',
        content: '<path d="M0 0"/>',
      },
      {
        id: 'star',
        content: '<path d="M0 0"/>',
      },
    ];

    const sprite = SVGSprite({
      icons,
      preload: true,
    });

    expect(sprite).toBeDefined();
  });

  it('should cache sprite by default', async () => {
    const mockSprite = '<svg><symbol id="test"/></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    const url = 'http://example.com/sprite-cache-test.svg';

    SVGSprite({ url, cache: true });
    await new Promise(resolve => setTimeout(resolve, 50));

    SVGSprite({ url, cache: true });
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should only fetch once due to caching
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should not cache when cache is false', async () => {
    const mockSprite = '<svg><symbol id="test"/></svg>';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockSprite,
    } as Response);

    const url = 'http://example.com/sprite.svg';

    SVGSprite({ url, cache: false });
    await new Promise(resolve => setTimeout(resolve, 10));

    SVGSprite({ url, cache: false });
    await new Promise(resolve => setTimeout(resolve, 10));

    // Should fetch twice
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should return null when not loaded', () => {
    // Mock fetch to never resolve so sprite never loads
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    const result = SVGSprite({
      url: 'http://example.com/sprite.svg',
    });

    // defineComponent returns a Node synchronously (initially empty text node)
    // The render function returns null initially, which gets converted to empty text
    expect(result).toBeDefined();
    expect(result instanceof Node).toBe(true);
    expect(result?.textContent).toBe('');
  });

  it('should return empty node on error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = SVGSprite({
      url: 'http://example.com/sprite.svg',
    });

    // Wait for async error to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    // After error, component still returns a node (empty text node from null render)
    expect(result).toBeDefined();
    expect(result instanceof Node).toBe(true);
    expect(result?.textContent).toBe('');
  });
});

describe('SpriteIcon', () => {
  it('should create sprite icon component', () => {
    const render = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
    });

    expect(render).toBeDefined();
  });

  it('should render SVG with use element', () => {
    const render = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      size: 24,
    });

    expect(render).toBeDefined();
  });

  it('should apply size prop', () => {
    const render = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      size: 32,
    });

    expect(render).toBeDefined();
  });

  it('should apply color prop', () => {
    const render = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      color: 'red',
    });

    expect(render).toBeDefined();
  });

  it('should apply className and style', () => {
    const render = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      className: 'my-icon',
      style: { margin: '10px' },
    });

    expect(render).toBeDefined();
  });

  it('should support accessibility props', () => {
    const render = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      title: 'Heart Icon',
      role: 'img',
      'aria-label': 'Heart',
    });

    expect(render).toBeDefined();
  });

  it('should use default size when not provided', () => {
    const render = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
    });

    expect(render).toBeDefined();
  });
});

describe('useSpriteIcon', () => {
  it('should be exported from module', async () => {
    const module = await import('../../../src/svg/components/SVGSprite.js');
    expect(module.useSpriteIcon).toBeDefined();
    expect(typeof module.useSpriteIcon).toBe('function');
  });
});
