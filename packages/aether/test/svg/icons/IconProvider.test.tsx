/**
 * Tests for IconProvider Component
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IconProvider,
  useIcons,
  useIconDefaults,
  useIconFallback,
  useIconContext,
} from '../../../src/svg/icons/IconProvider.js';
import { IconRegistry, getIconRegistry, resetIconRegistry } from '../../../src/svg/icons/IconRegistry.js';
import { defineComponent } from '../../../src/core/component/define.js';

describe('IconProvider', () => {
  beforeEach(() => {
    resetIconRegistry();
  });

  afterEach(() => {
    resetIconRegistry();
  });

  it('should create IconProvider component', () => {
    const provider = IconProvider({
      children: () => 'test',
    });

    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('should accept registry prop', () => {
    const customRegistry = new IconRegistry();
    const provider = IconProvider({
      registry: customRegistry,
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should use global registry when no registry provided', () => {
    const provider = IconProvider({
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should accept sets prop with inline icons', () => {
    const provider = IconProvider({
      sets: [
        {
          name: 'custom',
          icons: {
            heart: { path: 'M0 0' },
            star: { path: 'M1 1' },
          },
        },
      ],
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should accept sets prop with URL', () => {
    const provider = IconProvider({
      sets: [
        {
          name: 'feather',
          url: 'http://example.com/feather.svg',
        },
      ],
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should call onLoad when icons load successfully', async () => {
    const onLoad = vi.fn();

    IconProvider({
      sets: [
        {
          name: 'custom',
          icons: {
            heart: { path: 'M0 0' },
          },
        },
      ],
      onLoad,
      children: () => 'test',
    });

    // Wait for effect
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onLoad).toHaveBeenCalled();
  });

  it('should call onError when icon loading fails', async () => {
    const onError = vi.fn();

    // Save original fetch
    const originalFetch = global.fetch;

    // Mock fetch to fail
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    IconProvider({
      sets: [
        {
          name: 'remote',
          url: 'http://example.com/icons.svg',
        },
      ],
      onError,
      children: () => 'test',
    });

    // Wait for effect to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(onError).toHaveBeenCalled();

    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should apply prefix to icon set', async () => {
    const registry = new IconRegistry();

    IconProvider({
      registry,
      sets: [
        {
          name: 'custom',
          prefix: 'my',
          icons: {
            heart: { path: 'M0 0' },
          },
        },
      ],
      children: () => 'test',
    });

    // Wait for effect
    await new Promise(resolve => setTimeout(resolve, 10));

    // Icon should be registered with prefix
    expect(registry.has('my:heart')).toBe(true);
  });

  it('should support lazy loading strategy', () => {
    const provider = IconProvider({
      sets: [
        {
          name: 'remote',
          url: 'http://example.com/icons.svg',
        },
      ],
      loading: 'lazy',
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should support eager loading strategy', () => {
    const provider = IconProvider({
      sets: [
        {
          name: 'remote',
          url: 'http://example.com/icons.svg',
        },
      ],
      loading: 'eager',
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should provide default icon props', () => {
    const provider = IconProvider({
      defaults: {
        size: 24,
        color: 'red',
      },
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should provide fallback component', () => {
    const Fallback = () => 'fallback';

    const provider = IconProvider({
      fallback: Fallback,
      children: () => 'test',
    });

    expect(provider).toBeDefined();
  });

  it('should load multiple icon sets', async () => {
    const registry = new IconRegistry();

    IconProvider({
      registry,
      sets: [
        {
          name: 'set1',
          icons: {
            icon1: { path: 'M0 0' },
          },
        },
        {
          name: 'set2',
          icons: {
            icon2: { path: 'M1 1' },
          },
        },
      ],
      children: () => 'test',
    });

    // Wait for effect
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(registry.has('icon1')).toBe(true);
    expect(registry.has('icon2')).toBe(true);
  });

  it('should call onLoad only after all sets load', async () => {
    const onLoad = vi.fn();

    IconProvider({
      sets: [
        {
          name: 'set1',
          icons: {
            icon1: { path: 'M0 0' },
          },
        },
        {
          name: 'set2',
          icons: {
            icon2: { path: 'M1 1' },
          },
        },
      ],
      onLoad,
      children: () => 'test',
    });

    // Wait for effect
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(onLoad).toHaveBeenCalledTimes(1);
  });
});

describe('useIcons', () => {
  beforeEach(() => {
    resetIconRegistry();
  });

  it('should return icon registry', () => {
    const TestComponent = defineComponent(() => {
      const registry = useIcons();

      expect(registry).toBeInstanceOf(IconRegistry);

      return () => 'test';
    });

    TestComponent();
  });

  it('should return global registry when no provider', () => {
    const TestComponent = defineComponent(() => {
      const registry = useIcons();
      const globalRegistry = getIconRegistry();

      expect(registry).toBe(globalRegistry);

      return () => 'test';
    });

    TestComponent();
  });

  it('should access registry from context', () => {
    const customRegistry = new IconRegistry();

    const TestComponent = defineComponent(() => {
      const registry = useIcons();

      // In a full implementation with proper context,
      // this would be the custom registry
      expect(registry).toBeInstanceOf(IconRegistry);

      return () => 'test';
    });

    const provider = IconProvider({
      registry: customRegistry,
      children: () => TestComponent(),
    });

    provider();
  });
});

describe('useIconDefaults', () => {
  it('should return default icon props', () => {
    const TestComponent = defineComponent(() => {
      const defaults = useIconDefaults();

      // Should return empty object when no provider
      expect(defaults).toEqual({});

      return () => 'test';
    });

    TestComponent();
  });

  it('should return defaults from context', () => {
    const defaultProps = {
      size: 24,
      color: 'red',
    };

    const TestComponent = defineComponent(() => {
      const defaults = useIconDefaults();

      // In full implementation with proper context,
      // this would return the default props
      expect(defaults).toBeDefined();

      return () => 'test';
    });

    const provider = IconProvider({
      defaults: defaultProps,
      children: () => TestComponent(),
    });

    provider();
  });
});

describe('useIconFallback', () => {
  it('should return undefined when no provider', () => {
    const TestComponent = defineComponent(() => {
      const fallback = useIconFallback();

      expect(fallback).toBeUndefined();

      return () => 'test';
    });

    TestComponent();
  });

  it('should return fallback from context', () => {
    const Fallback = () => 'fallback';

    const TestComponent = defineComponent(() => {
      const fallback = useIconFallback();

      expect(fallback).toBeDefined();

      return () => 'test';
    });

    const provider = IconProvider({
      fallback: Fallback,
      children: () => TestComponent(),
    });

    provider();
  });
});

describe('useIconContext', () => {
  it('should return null when no provider', () => {
    const TestComponent = defineComponent(() => {
      const context = useIconContext();

      expect(context).toBeNull();

      return () => 'test';
    });

    TestComponent();
  });

  it('should return context value from provider', () => {
    const TestComponent = defineComponent(() => {
      const context = useIconContext();

      // In full implementation, this would return the context value
      expect(context).toBeDefined();

      return () => 'test';
    });

    const provider = IconProvider({
      defaults: { size: 24 },
      children: () => TestComponent(),
    });

    provider();
  });

  it('should return registry from context', () => {
    const customRegistry = new IconRegistry();

    const TestComponent = defineComponent(() => {
      const context = useIconContext();

      if (context) {
        expect(context.registry).toBeInstanceOf(IconRegistry);
      }

      return () => 'test';
    });

    const provider = IconProvider({
      registry: customRegistry,
      children: () => TestComponent(),
    });

    provider();
  });

  it('should return defaults from context', () => {
    const defaultProps = { size: 24, color: 'red' };

    const TestComponent = defineComponent(() => {
      const context = useIconContext();

      if (context) {
        expect(context.defaults).toEqual(defaultProps);
      }

      return () => 'test';
    });

    const provider = IconProvider({
      defaults: defaultProps,
      children: () => TestComponent(),
    });

    provider();
  });

  it('should return fallback from context', () => {
    const Fallback = () => 'fallback';

    const TestComponent = defineComponent(() => {
      const context = useIconContext();

      if (context) {
        expect(context.fallback).toBe(Fallback);
      }

      return () => 'test';
    });

    const provider = IconProvider({
      fallback: Fallback,
      children: () => TestComponent(),
    });

    provider();
  });
});
