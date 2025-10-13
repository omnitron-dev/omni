/**
 * Islands Integration Tests
 *
 * End-to-end tests for the islands architecture
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defineComponent } from '../../src/core/component/define.js';
import { island } from '../../src/islands/directives.js';
import { renderToStringWithIslands, resetIslandIdCounter } from '../../src/islands/renderer.js';
import { detectInteractivity } from '../../src/islands/detector.js';
import type { IslandComponent } from '../../src/islands/types.js';

describe('Islands Integration', () => {
  beforeEach(() => {
    resetIslandIdCounter();
  });

  describe('End-to-end rendering', () => {
    it('should render static component without islands', () => {
      const StaticComponent = defineComponent(() => {
        return () => (
          <div>
            <h1>Static Header</h1>
            <p>This is static content</p>
          </div>
        );
      });

      const result = renderToStringWithIslands(StaticComponent);

      expect(result.html).toContain('Static Header');
      expect(result.islands).toHaveLength(0);
      expect(result.hydrationScript).toBe('');
    });

    it('should render component with islands', () => {
      const InteractiveCounter: IslandComponent = island(
        defineComponent(() => {
          return () => (
            <button onClick={() => {}}>
              Count: 0
            </button>
          );
        }),
        { hydrate: 'interaction' },
      );

      const Page = defineComponent(() => {
        return () => (
          <div>
            <h1>My Page</h1>
            <InteractiveCounter />
          </div>
        );
      });

      const result = renderToStringWithIslands(Page);

      expect(result.html).toContain('My Page');
      expect(result.islands).toHaveLength(1);
      expect(result.islands[0].strategy).toBe('interaction');
      expect(result.hydrationScript).toContain('__AETHER_ISLANDS__');
    });

    it('should handle nested islands', () => {
      const NestedIsland: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Nested</div>;
        }),
      );

      const ParentIsland: IslandComponent = island(
        defineComponent(() => {
          return () => (
            <div>
              Parent
              <NestedIsland />
            </div>
          );
        }),
      );

      const result = renderToStringWithIslands(ParentIsland);

      expect(result.islands.length).toBeGreaterThan(0);
    });

    it('should serialize island props', () => {
      const PropsIsland: IslandComponent = island(
        defineComponent<{ count: number; label: string }>(() => {
          return () => <div>Test</div>;
        }),
      );

      const Page = defineComponent(() => {
        return () => <PropsIsland count={5} label="Test" />;
      });

      const result = renderToStringWithIslands(Page);

      expect(result.islands).toHaveLength(1);
      expect(result.islands[0].props).toContain('count');
      expect(result.islands[0].props).toContain('label');
    });

    it('should generate unique island IDs', () => {
      const Island1: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Island 1</div>;
        }),
      );

      const Island2: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Island 2</div>;
        }),
      );

      const Page = defineComponent(() => {
        return () => (
          <div>
            <Island1 />
            <Island2 />
          </div>
        );
      });

      const result = renderToStringWithIslands(Page);

      expect(result.islands).toHaveLength(2);
      expect(result.islands[0].id).not.toBe(result.islands[1].id);
    });
  });

  describe('Hydration strategies', () => {
    it('should apply immediate hydration', () => {
      const ImmediateIsland: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Immediate</div>;
        }),
        { hydrate: 'immediate' },
      );

      const result = renderToStringWithIslands(ImmediateIsland);

      expect(result.islands[0].strategy).toBe('immediate');
    });

    it('should apply visible hydration with rootMargin', () => {
      const VisibleIsland: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Visible</div>;
        }),
        { hydrate: 'visible', rootMargin: '100px' },
      );

      const result = renderToStringWithIslands(VisibleIsland);

      expect(result.islands[0].strategy).toBe('visible');
    });

    it('should apply interaction hydration', () => {
      const InteractionIsland: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Interaction</div>;
        }),
        { hydrate: 'interaction', events: ['click', 'focus'] },
      );

      const result = renderToStringWithIslands(InteractionIsland);

      expect(result.islands[0].strategy).toBe('interaction');
    });

    it('should apply idle hydration', () => {
      const IdleIsland: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Idle</div>;
        }),
        { hydrate: 'idle', timeout: 3000 },
      );

      const result = renderToStringWithIslands(IdleIsland);

      expect(result.islands[0].strategy).toBe('idle');
    });

    it('should apply media hydration', () => {
      const MediaIsland: IslandComponent = island(
        defineComponent(() => {
          return () => <div>Media</div>;
        }),
        { hydrate: 'media', query: '(max-width: 768px)' },
      );

      const result = renderToStringWithIslands(MediaIsland);

      expect(result.islands[0].strategy).toBe('media');
    });
  });

  describe('Auto-detection', () => {
    it('should auto-detect interactive components', () => {
      const AutoIsland = defineComponent(() => {
        return () => <button onClick={() => {}}>Click</button>;
      });

      const detection = detectInteractivity(AutoIsland);

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('event-handler');
    });

    it('should recommend appropriate strategy', () => {
      const WebSocketComponent = defineComponent(() => {
        const ws = new WebSocket('ws://localhost');
        return () => <div>WebSocket</div>;
      });

      const detection = detectInteractivity(WebSocketComponent);

      expect(detection.recommendedStrategy).toBe('immediate');
    });
  });

  describe('Mixed content', () => {
    it('should handle mix of static and interactive content', () => {
      const InteractiveButton: IslandComponent = island(
        defineComponent(() => {
          return () => <button onClick={() => {}}>Click</button>;
        }),
      );

      const MixedPage = defineComponent(() => {
        return () => (
          <div>
            <header>
              <h1>Static Header</h1>
            </header>
            <main>
              <p>Static paragraph</p>
              <InteractiveButton />
              <p>More static content</p>
            </main>
            <footer>Static Footer</footer>
          </div>
        );
      });

      const result = renderToStringWithIslands(MixedPage);

      expect(result.html).toContain('Static Header');
      expect(result.html).toContain('Static Footer');
      expect(result.islands).toHaveLength(1);
    });
  });

  describe('Performance', () => {
    it('should minimize JavaScript for mostly static pages', () => {
      const TinyIsland: IslandComponent = island(
        defineComponent(() => {
          return () => <button onClick={() => {}}>Like</button>;
        }),
      );

      const MostlyStaticPage = defineComponent(() => {
        return () => (
          <article>
            <h1>Blog Post Title</h1>
            <div>Long static content...</div>
            <div>More static content...</div>
            <div>Even more static content...</div>
            <TinyIsland />
          </article>
        );
      });

      const result = renderToStringWithIslands(MostlyStaticPage);

      // Should have only 1 small island
      expect(result.islands).toHaveLength(1);
    });
  });
});
