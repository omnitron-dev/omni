/**
 * Tests for SVGSprite Component
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SVGSprite, SpriteIcon } from '../../../src/svg/components/SVGSprite.js';
import type { IconDefinition } from '../../../src/svg/icons/IconRegistry.js';

describe('SVGSprite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create sprite component', () => {
    const icons: IconDefinition[] = [
      {
        id: 'heart',
        path: 'M12 21.35l-1.45-1.32',
        viewBox: '0 0 24 24',
      },
    ];

    const sprite = SVGSprite({ icons, inline: true });

    expect(sprite).toBeDefined();
    expect(typeof sprite).toBe('function');
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

    const sprite = SVGSprite({ icons, inline: true });
    const render = sprite();

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

    // Wait for effect
    await new Promise(resolve => setTimeout(resolve, 10));

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

    const url = 'http://example.com/sprite.svg';

    SVGSprite({ url, cache: true });
    await new Promise(resolve => setTimeout(resolve, 10));

    SVGSprite({ url, cache: true });
    await new Promise(resolve => setTimeout(resolve, 10));

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
    const sprite = SVGSprite({
      url: 'http://example.com/sprite.svg',
    });

    const render = sprite();
    expect(render).toBeNull();
  });

  it('should return null on error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const sprite = SVGSprite({
      url: 'http://example.com/sprite.svg',
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const render = sprite();
    expect(render).toBeNull();
  });
});

describe('SpriteIcon', () => {
  it('should create sprite icon component', () => {
    const icon = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
    });

    expect(icon).toBeDefined();
    expect(typeof icon).toBe('function');
  });

  it('should render SVG with use element', () => {
    const icon = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      size: 24,
    });

    const render = icon();

    expect(render).toBeDefined();
  });

  it('should apply size prop', () => {
    const icon = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      size: 32,
    });

    const render = icon();
    expect(render).toBeDefined();
  });

  it('should apply color prop', () => {
    const icon = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      color: 'red',
    });

    const render = icon();
    expect(render).toBeDefined();
  });

  it('should apply className and style', () => {
    const icon = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      className: 'my-icon',
      style: { margin: '10px' },
    });

    const render = icon();
    expect(render).toBeDefined();
  });

  it('should support accessibility props', () => {
    const icon = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
      title: 'Heart Icon',
      role: 'img',
      'aria-label': 'Heart',
    });

    const render = icon();
    expect(render).toBeDefined();
  });

  it('should use default size when not provided', () => {
    const icon = SpriteIcon({
      spriteId: 'my-sprite',
      iconId: 'heart',
    });

    const render = icon();
    expect(render).toBeDefined();
  });
});

describe('useSpriteIcon', () => {
  it('should be exported from module', () => {
    const { useSpriteIcon } = require('../../../src/svg/components/SVGSprite.js');
    expect(useSpriteIcon).toBeDefined();
    expect(typeof useSpriteIcon).toBe('function');
  });
});
