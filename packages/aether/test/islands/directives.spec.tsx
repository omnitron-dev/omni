/**
 * Island Directives Tests
 */

import { describe, it, expect } from 'vitest';
import { defineComponent } from '../../src/core/component/define.js';
import {
  island,
  islandBoundary,
  staticHint,
  isStaticComponent,
  defer,
  conditionalIsland,
  mediaIsland,
  viewportIsland,
  interactionIsland,
  idleIsland,
} from '../../src/islands/directives.js';

describe('Island Directives', () => {
  describe('island', () => {
    it('should mark component as island', () => {
      const component = island(
        defineComponent(() => () => <div>Test</div>),
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions).toBeDefined();
    });

    it('should use provided hydration strategy', () => {
      const component = island(
        defineComponent(() => () => <div>Test</div>),
        {
          hydrate: 'visible',
        },
      );

      expect(component.__islandOptions.hydrate).toBe('visible');
    });

    it('should auto-detect strategy if not provided', () => {
      const component = island(
        defineComponent(() => () => <button onClick={() => {}}>Click</button>),
      );

      expect(component.__islandOptions.hydrate).toBeDefined();
    });

    it('should generate island ID', () => {
      const component = island(
        defineComponent(() => () => <div>Test</div>),
      );

      expect(component.__islandId).toBeDefined();
      expect(typeof component.__islandId).toBe('string');
    });

    it('should use provided name', () => {
      const component = island(
        defineComponent(() => () => <div>Test</div>),
        {
          name: 'MyIsland',
        },
      );

      expect(component.__islandId).toBe('MyIsland');
    });
  });

  describe('islandBoundary', () => {
    it('should create named island', () => {
      const component = islandBoundary(
        'test-island',
        defineComponent(() => () => <div>Test</div>),
        {
          hydrate: 'idle',
        },
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions.name).toBe('test-island');
      expect(component.__islandOptions.hydrate).toBe('idle');
    });
  });

  describe('staticHint', () => {
    it('should mark component as static', () => {
      const component = staticHint(
        defineComponent(() => () => <div>Static</div>),
      );

      expect(isStaticComponent(component)).toBe(true);
    });
  });

  describe('defer', () => {
    it('should create deferred island with idle strategy', () => {
      const component = defer(
        defineComponent(() => () => <div>Test</div>),
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions.hydrate).toBe('idle');
    });

    it('should allow custom defer strategy', () => {
      const component = defer(
        defineComponent(() => () => <div>Test</div>),
        'visible',
      );

      expect(component.__islandOptions.hydrate).toBe('visible');
    });
  });

  describe('conditionalIsland', () => {
    it('should create island with custom condition', () => {
      const condition = () => true;
      const component = conditionalIsland(
        defineComponent(() => () => <div>Test</div>),
        condition,
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions.hydrate).toBe('custom');
      expect(component.__islandOptions.shouldHydrate).toBe(condition);
    });
  });

  describe('mediaIsland', () => {
    it('should create media query island', () => {
      const query = '(max-width: 768px)';
      const component = mediaIsland(
        defineComponent(() => () => <div>Test</div>),
        query,
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions.hydrate).toBe('media');
      expect(component.__islandOptions.query).toBe(query);
    });
  });

  describe('viewportIsland', () => {
    it('should create viewport island', () => {
      const component = viewportIsland(
        defineComponent(() => () => <div>Test</div>),
        '100px',
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions.hydrate).toBe('visible');
      expect(component.__islandOptions.rootMargin).toBe('100px');
    });

    it('should use default root margin', () => {
      const component = viewportIsland(
        defineComponent(() => () => <div>Test</div>),
      );

      expect(component.__islandOptions.rootMargin).toBe('0px');
    });
  });

  describe('interactionIsland', () => {
    it('should create interaction island', () => {
      const events = ['click', 'focus'];
      const component = interactionIsland(
        defineComponent(() => () => <div>Test</div>),
        events,
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions.hydrate).toBe('interaction');
      expect(component.__islandOptions.events).toEqual(events);
    });

    it('should use default events', () => {
      const component = interactionIsland(
        defineComponent(() => () => <div>Test</div>),
      );

      expect(component.__islandOptions.events).toEqual(['click', 'focus', 'touchstart']);
    });
  });

  describe('idleIsland', () => {
    it('should create idle island', () => {
      const component = idleIsland(
        defineComponent(() => () => <div>Test</div>),
        3000,
      );

      expect(component.__island).toBe(true);
      expect(component.__islandOptions.hydrate).toBe('idle');
      expect(component.__islandOptions.timeout).toBe(3000);
    });

    it('should use default timeout', () => {
      const component = idleIsland(
        defineComponent(() => () => <div>Test</div>),
      );

      expect(component.__islandOptions.timeout).toBe(2000);
    });
  });
});
