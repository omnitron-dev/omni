/**
 * Island Detector Tests
 */

import { describe, it, expect } from 'vitest';
import { defineComponent } from '../../src/core/component/define.js';
import {
  detectInteractivity,
  getIslandComponents,
  estimateComponentSize,
  isIslandComponent,
  getComponentMetadata,
} from '../../src/islands/detector.js';
import { island } from '../../src/islands/directives.js';

describe('Island Detector', () => {
  describe('detectInteractivity', () => {
    it('should detect event handlers', () => {
      const component = defineComponent(() => {
        return () => <button onClick={() => {}}>Click</button>;
      });

      const detection = detectInteractivity(component);

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('event-handler');
    });

    it('should detect reactive state', () => {
      const component = defineComponent(() => {
        const count = signal(0);
        return () => <div>{count()}</div>;
      });

      const detection = detectInteractivity(component);

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('reactive-state');
    });

    it('should detect lifecycle hooks', () => {
      const component = defineComponent(() => {
        onMount(() => {
          console.log('mounted');
        });
        return () => <div>Test</div>;
      });

      const detection = detectInteractivity(component);

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('lifecycle-hook');
    });

    it('should detect browser APIs', () => {
      const component = defineComponent(() => {
        const width = () => window.innerWidth;
        return () => <div>{width()}</div>;
      });

      const detection = detectInteractivity(component);

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('browser-api');
    });

    it('should detect timers', () => {
      const component = defineComponent(() => {
        setTimeout(() => {}, 1000);
        return () => <div>Test</div>;
      });

      const detection = detectInteractivity(component);

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('timer');
    });

    it('should detect WebSocket', () => {
      const component = defineComponent(() => {
        const ws = new WebSocket('ws://localhost');
        return () => <div>Test</div>;
      });

      const detection = detectInteractivity(component);

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('websocket');
    });

    it('should identify static components', () => {
      const component = defineComponent(() => {
        return () => <div>Static content</div>;
      });

      const detection = detectInteractivity(component);

      expect(detection.isInteractive).toBe(false);
      expect(detection.signals).toHaveLength(0);
    });

    it('should recommend hydration strategies', () => {
      const immediateComponent = defineComponent(() => {
        const ws = new WebSocket('ws://localhost');
        return () => <div onClick={() => {}}>Test</div>;
      });

      const detection = detectInteractivity(immediateComponent);
      expect(detection.recommendedStrategy).toBe('immediate');
    });

    it('should respect custom rules', () => {
      const component = defineComponent(() => {
        return () => <div>Test</div>;
      });

      const detection = detectInteractivity(component, {
        customRules: [(comp) => comp.name === component.name],
      });

      expect(detection.isInteractive).toBe(true);
      expect(detection.signals).toContain('custom');
    });

    it('should respect exclusion patterns', () => {
      const component = defineComponent(() => {
        return () => <button onClick={() => {}}>Click</button>;
      });
      component.displayName = 'ExcludedComponent';

      const detection = detectInteractivity(component, {
        exclude: [/Excluded/],
      });

      expect(detection.isInteractive).toBe(false);
    });
  });

  describe('getIslandComponents', () => {
    it('should filter interactive components', () => {
      const interactive = defineComponent(() => {
        return () => <button onClick={() => {}}>Click</button>;
      });

      const static1 = defineComponent(() => {
        return () => <div>Static</div>;
      });

      const components = [interactive, static1];
      const islands = getIslandComponents(components);

      expect(islands).toHaveLength(1);
      expect(islands[0]).toBe(interactive);
    });
  });

  describe('estimateComponentSize', () => {
    it('should estimate component bundle size', () => {
      const component = defineComponent(() => {
        const count = signal(0);
        return () => <button onClick={() => count.set(count() + 1)}>{count()}</button>;
      });

      const size = estimateComponentSize(component);

      expect(size).toBeGreaterThan(0);
      expect(typeof size).toBe('number');
    });

    it('should account for imports', () => {
      const componentWithImports = defineComponent(() => {
        // Simulated imports in source
        return () => <div>Test</div>;
      });

      const size = estimateComponentSize(componentWithImports);

      expect(size).toBeGreaterThan(500); // Base runtime
    });
  });

  describe('isIslandComponent', () => {
    it('should identify island components', () => {
      const component = island(
        defineComponent(() => {
          return () => <div>Island</div>;
        }),
      );

      expect(isIslandComponent(component)).toBe(true);
    });

    it('should return false for non-island components', () => {
      const component = defineComponent(() => {
        return () => <div>Not island</div>;
      });

      expect(isIslandComponent(component)).toBe(false);
    });
  });

  describe('getComponentMetadata', () => {
    it('should extract component metadata', () => {
      const component = defineComponent(() => {
        return () => <button onClick={() => {}}>Click</button>;
      });
      component.displayName = 'TestComponent';

      const metadata = getComponentMetadata(component);

      expect(metadata.displayName).toBe('TestComponent');
      expect(metadata.isInteractive).toBe(true);
      expect(metadata.size).toBeGreaterThan(0);
      expect(typeof metadata.source).toBe('string');
    });
  });
});

// Mock functions for testing
function signal(value: any) {
  return () => value;
}

function onMount(fn: () => void) {
  // Mock
}
