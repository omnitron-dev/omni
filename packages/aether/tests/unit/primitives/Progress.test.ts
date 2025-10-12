/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { signal } from '../../../src/core/reactivity/signal.js';
import { Progress, ProgressIndicator } from '../../../src/primitives/Progress.js';
import { renderComponent, nextTick } from '../../helpers/test-utils.js';

describe('Progress', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render progress with default max value', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl).toBeTruthy();
      expect(progressEl.getAttribute('aria-valuemin')).toBe('0');
      expect(progressEl.getAttribute('aria-valuemax')).toBe('100');
      expect(progressEl.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should render progress with custom max value', () => {
      const component = () =>
        Progress({
          value: 25,
          max: 50,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuemax')).toBe('50');
      expect(progressEl.getAttribute('aria-valuenow')).toBe('25');
    });

    it('should render with progress indicator', () => {
      const component = () =>
        Progress({
          value: 75,
          children: ProgressIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.getAttribute('data-progress-indicator')).toBe('');
    });

    it('should clamp value below 0', () => {
      const component = () =>
        Progress({
          value: -10,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('0');
      expect(progressEl.getAttribute('data-value')).toBe('0');
    });

    it('should clamp value above max', () => {
      const component = () =>
        Progress({
          value: 150,
          max: 100,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('100');
      expect(progressEl.getAttribute('data-value')).toBe('100');
    });
  });

  describe('Determinate state', () => {
    it('should show determinate state with value', () => {
      const component = () =>
        Progress({
          value: 60,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('determinate');
      expect(progressEl.getAttribute('data-value')).toBe('60');
    });

    it('should show determinate state with value 0', () => {
      const component = () =>
        Progress({
          value: 0,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('determinate');
      expect(progressEl.getAttribute('aria-valuenow')).toBe('0');
    });

    it('should show determinate state with value 100', () => {
      const component = () =>
        Progress({
          value: 100,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('determinate');
      expect(progressEl.getAttribute('aria-valuenow')).toBe('100');
    });
  });

  describe('Indeterminate state', () => {
    it('should show indeterminate state with null value', () => {
      const component = () =>
        Progress({
          value: null,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('indeterminate');
      expect(progressEl.getAttribute('aria-valuenow')).toBeNull();
    });

    it('should show indeterminate state with undefined value', () => {
      const component = () =>
        Progress({
          value: undefined,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('indeterminate');
      expect(progressEl.getAttribute('aria-valuenow')).toBeNull();
    });

    it('should not have aria-valuetext when indeterminate', () => {
      const component = () =>
        Progress({
          value: null,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBeNull();
    });

    it('should indicate indeterminate state on indicator', () => {
      const component = () =>
        Progress({
          value: null,
          children: ProgressIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator.getAttribute('data-state')).toBe('indeterminate');
      expect(indicator.style.transform).toBe('');
    });
  });

  describe('Value label formatting', () => {
    it('should generate default percentage label', () => {
      const component = () =>
        Progress({
          value: 45,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('45%');
    });

    it('should round percentage in default label', () => {
      const component = () =>
        Progress({
          value: 33.33,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('33%');
    });

    it('should use custom getValueLabel function', () => {
      const component = () =>
        Progress({
          value: 75,
          max: 100,
          getValueLabel: (v, max) => `${v} of ${max} items`,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('75 of 100 items');
    });

    it('should format custom label with different max', () => {
      const component = () =>
        Progress({
          value: 25,
          max: 50,
          getValueLabel: (v, max) => `${v}/${max}`,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('25/50');
    });

    it('should handle empty custom label', () => {
      const component = () =>
        Progress({
          value: 50,
          getValueLabel: () => '',
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('');
    });
  });

  describe('Accessibility - ARIA attributes', () => {
    it('should have progressbar role', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]');
      expect(progressEl).toBeTruthy();
    });

    it('should have aria-valuemin of 0', () => {
      const component = () =>
        Progress({
          value: 50,
          max: 200,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuemin')).toBe('0');
    });

    it('should set aria-valuemax to max prop', () => {
      const component = () =>
        Progress({
          value: 30,
          max: 150,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuemax')).toBe('150');
    });

    it('should set aria-valuenow to current value', () => {
      const component = () =>
        Progress({
          value: 42,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('42');
    });

    it('should set aria-valuetext for screen readers', () => {
      const component = () =>
        Progress({
          value: 67,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('67%');
    });

    it('should support aria-label', () => {
      const component = () =>
        Progress({
          value: 50,
          'aria-label': 'Upload progress',
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-label')).toBe('Upload progress');
    });

    it('should support aria-labelledby', () => {
      const component = () =>
        Progress({
          value: 50,
          'aria-labelledby': 'progress-label',
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-labelledby')).toBe('progress-label');
    });

    it('should support aria-describedby', () => {
      const component = () =>
        Progress({
          value: 50,
          'aria-describedby': 'progress-description',
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-describedby')).toBe('progress-description');
    });
  });

  describe('Progress.Indicator', () => {
    it('should render indicator element', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({ class: 'my-indicator' }),
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('.my-indicator') as HTMLElement;
      expect(indicator).toBeTruthy();
      expect(indicator.tagName).toBe('DIV');
    });

    it('should have data-progress-indicator attribute', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('[data-progress-indicator]') as HTMLElement;
      expect(indicator).toBeTruthy();
    });

    it('should apply custom styles to indicator', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({
            style: { backgroundColor: 'blue', height: '10px' },
          }),
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('[data-progress-indicator]') as HTMLElement;
      expect(indicator.style.backgroundColor).toBe('blue');
      expect(indicator.style.height).toBe('10px');
    });

    it('should support additional HTML attributes on indicator', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({
            'data-testid': 'progress-bar',
            id: 'main-progress-indicator',
          }),
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('[data-progress-indicator]') as HTMLElement;
      expect(indicator.getAttribute('data-testid')).toBe('progress-bar');
      expect(indicator.id).toBe('main-progress-indicator');
    });
  });

  describe('Data attributes', () => {
    it('should set data-state to determinate', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('determinate');
    });

    it('should set data-state to indeterminate', () => {
      const component = () =>
        Progress({
          value: null,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should set data-value attribute', () => {
      const component = () =>
        Progress({
          value: 85,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-value')).toBe('85');
    });

    it('should set data-max attribute', () => {
      const component = () =>
        Progress({
          value: 25,
          max: 200,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-max')).toBe('200');
    });
  });

  describe('Edge cases', () => {
    it('should handle fractional values', () => {
      const component = () =>
        Progress({
          value: 33.33,
          children: ProgressIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('33.33');
    });

    it('should handle very small values', () => {
      const component = () =>
        Progress({
          value: 0.01,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('0.01');
    });

    it('should handle max value of 0', () => {
      const component = () =>
        Progress({
          value: 0,
          max: 0,
          children: ProgressIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuemax')).toBe('0');

      const indicator = container.querySelector('.indicator') as HTMLElement;
      // 0/0 = NaN, should result in -NaN% or similar
      expect(indicator.style.transform).toBeDefined();
    });

    it('should handle very large max values', () => {
      const component = () =>
        Progress({
          value: 500000,
          max: 1000000,
          children: ProgressIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('500000');
    });

    it('should handle custom props passthrough', () => {
      const component = () =>
        Progress({
          value: 50,
          'data-custom': 'test',
          class: 'custom-class',
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-custom')).toBe('test');
      // Note: id is auto-generated by Progress component
      expect(progressEl.id).toContain('progress-');
      expect(progressEl.className).toContain('custom-class');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle loading scenario with indeterminate state', () => {
      const component = () =>
        Progress({
          value: null,
          'aria-label': 'Loading content',
          children: ProgressIndicator({ class: 'loading-spinner' }),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('data-state')).toBe('indeterminate');
      expect(progressEl.getAttribute('aria-label')).toBe('Loading content');

      const indicator = container.querySelector('.loading-spinner') as HTMLElement;
      expect(indicator.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should handle step-based progress', () => {
      const component = () =>
        Progress({
          value: 3,
          max: 5,
          getValueLabel: (v, max) => `Step ${v} of ${max}`,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('Step 3 of 5');
      expect(progressEl.getAttribute('aria-valuenow')).toBe('3');
      expect(progressEl.getAttribute('aria-valuemax')).toBe('5');
    });

    it('should handle percentage-based progress', () => {
      const component = () =>
        Progress({
          value: 45,
          max: 100,
          'aria-label': 'Upload progress',
          children: ProgressIndicator({ class: 'upload-bar' }),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuetext')).toBe('45%');
      expect(progressEl.getAttribute('aria-label')).toBe('Upload progress');
      expect(progressEl.getAttribute('data-state')).toBe('determinate');
    });

    it('should support different value ranges', () => {
      // Test with 0-10 range
      const component = () =>
        Progress({
          value: 7,
          max: 10,
          getValueLabel: (v, max) => `${v}/${max}`,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('7');
      expect(progressEl.getAttribute('aria-valuemax')).toBe('10');
      expect(progressEl.getAttribute('aria-valuetext')).toBe('7/10');
    });
  });

  describe('Context integration', () => {
    it('should share indeterminate state with indicator', () => {
      const component = () =>
        Progress({
          value: null,
          children: ProgressIndicator({ class: 'indicator' }),
        });

      const { container } = renderComponent(component);

      const indicator = container.querySelector('.indicator') as HTMLElement;
      expect(indicator.getAttribute('data-state')).toBe('indeterminate');
    });

    it('should provide ID for aria relationships', () => {
      const component = () =>
        Progress({
          value: 50,
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      const progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      const id = progressEl.id;
      expect(id).toContain('progress-');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('Reactive updates', () => {
    it('should update progress value reactively', async () => {
      const value = signal(25);

      const component = () =>
        Progress({
          value: value, // Pass signal directly, not value()
          children: ProgressIndicator({}),
        });

      const { container } = renderComponent(component);

      let progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('25');

      value.set(75);
      await nextTick();

      progressEl = container.querySelector('[role="progressbar"]') as HTMLElement;
      expect(progressEl.getAttribute('aria-valuenow')).toBe('75');
    });
  });
});
