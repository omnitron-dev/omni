/**
 * Tests for Server-Side Rendering
 */

import { describe, it, expect } from 'vitest';
import { renderSVGToString, renderSVGBatch, createServerSVG } from '../../../src/svg/ssr/render.js';
import type { Component } from '../../../src/core/component/types.js';

describe('SSR Render - renderSVGToString', () => {
  it('should render simple SVG component to string', () => {
    const TestSVG: Component<{ size: number }> = (props) => () => ({
        type: 'svg',
        props: {
          width: props.size,
          height: props.size,
          children: {
            type: 'circle',
            props: {
              cx: props.size / 2,
              cy: props.size / 2,
              r: props.size / 4,
            },
          },
        },
      });

    const result = renderSVGToString(TestSVG, { size: 100 });
    expect(result).toContain('<svg');
    expect(result).toContain('width="100"');
    expect(result).toContain('height="100"');
    expect(result).toContain('<circle');
  });

  it('should handle renderToString config option', () => {
    const TestSVG: Component = () => () => ({ type: 'svg', props: {} });

    const result1 = renderSVGToString(TestSVG, {}, { renderToString: true });
    expect(result1).toContain('<svg');

    const result2 = renderSVGToString(TestSVG, {}, { renderToString: false });
    expect(result2).toBe('');
  });

  it('should minify output when requested', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        children: [
          { type: 'circle', props: { r: 5 } },
          { type: 'rect', props: { width: 10, height: 10 } },
        ],
      },
    });

    const minified = renderSVGToString(TestSVG, {}, { minify: true });
    expect(minified).not.toContain('\n');
    expect(minified).not.toContain('  ');
  });

  it('should add hydration markers when requested', () => {
    const TestSVG: Component = () => () => ({ type: 'svg', props: {} });

    const result = renderSVGToString(
      TestSVG,
      { test: 'value' },
      {
        addHydrationMarkers: true,
        componentName: 'TestSVG',
      }
    );

    expect(result).toContain('data-aether-hydrate="TestSVG"');
    expect(result).toContain('data-aether-props');
  });

  it('should handle component errors gracefully', () => {
    const ErrorSVG: Component = () => {
      throw new Error('Test error');
    };

    const result = renderSVGToString(ErrorSVG);
    expect(result).toContain('<!--');
    expect(result).toContain('SVG render error');
  });

  it('should render primitive values', () => {
    const TextSVG: Component = () => () => 'Hello World';
    const result = renderSVGToString(TextSVG);
    expect(result).toBe('Hello World');
  });

  it('should handle null/undefined components', () => {
    const NullSVG: Component = () => () => null;
    const result = renderSVGToString(NullSVG);
    expect(result).toBe('');
  });

  it('should render nested components', () => {
    const Inner: Component = () => () => ({ type: 'circle', props: { r: 5 } });
    const Outer: Component = () => () => ({
      type: 'svg',
      props: {
        children: Inner,
      },
    });

    const result = renderSVGToString(Outer);
    expect(result).toContain('<svg');
    expect(result).toContain('<circle');
  });

  it('should handle array children', () => {
    const ArraySVG: Component = () => () => ({
      type: 'svg',
      props: {
        children: [
          { type: 'circle', props: { r: 5 } },
          { type: 'rect', props: { width: 10 } },
        ],
      },
    });

    const result = renderSVGToString(ArraySVG);
    expect(result).toContain('<circle');
    expect(result).toContain('<rect');
  });
});

describe('SSR Render - SVG Element Rendering', () => {
  it('should render SVG attributes correctly', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        width: 100,
        height: 200,
        viewBox: '0 0 100 200',
        className: 'test-class',
      },
    });

    const result = renderSVGToString(TestSVG);
    expect(result).toContain('width="100"');
    expect(result).toContain('height="200"');
    expect(result).toContain('viewBox="0 0 100 200"');
    expect(result).toContain('class="test-class"');
  });

  it('should handle style objects', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        style: { fill: 'red', strokeWidth: '2px' },
      },
    });

    const result = renderSVGToString(TestSVG, {}, { inlineStyles: true });
    expect(result).toContain('style=');
    expect(result).toContain('fill: red');
    expect(result).toContain('stroke-width: 2px');
  });

  it('should handle data attributes', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        'data-icon': 'test',
        'data-version': '1.0',
      },
    });

    const result = renderSVGToString(TestSVG);
    expect(result).toContain('data-icon="test"');
    expect(result).toContain('data-version="1.0"');
  });

  it('should handle aria attributes', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        'aria-label': 'Test Icon',
        'aria-hidden': 'true',
      },
    });

    const result = renderSVGToString(TestSVG);
    expect(result).toContain('aria-label="Test Icon"');
    expect(result).toContain('aria-hidden="true"');
  });

  it('should handle boolean attributes', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        required: true,
        disabled: false,
      },
    });

    const result = renderSVGToString(TestSVG);
    expect(result).toContain('required');
    expect(result).not.toContain('disabled');
  });

  it('should escape attribute values', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        'data-value': '<script>alert()</script>',
      },
    });

    const result = renderSVGToString(TestSVG);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });
});

describe('SSR Render - renderSVGBatch', () => {
  it('should render multiple components', () => {
    const SVG1: Component = () => () => ({ type: 'svg', props: { 'data-id': '1' } });
    const SVG2: Component = () => () => ({ type: 'svg', props: { 'data-id': '2' } });

    const result = renderSVGBatch([
      { component: SVG1 },
      { component: SVG2 },
    ]);

    expect(result).toContain('data-id="1"');
    expect(result).toContain('data-id="2"');
  });

  it('should pass props to each component', () => {
    const DynamicSVG: Component<{ id: string }> = (props) => () => ({
      type: 'svg',
      props: { 'data-id': props.id },
    });

    const result = renderSVGBatch([
      { component: DynamicSVG, props: { id: 'first' } },
      { component: DynamicSVG, props: { id: 'second' } },
    ]);

    expect(result).toContain('data-id="first"');
    expect(result).toContain('data-id="second"');
  });

  it('should apply config to all components', () => {
    const TestSVG: Component = () => () => ({ type: 'svg', props: {} });

    const result = renderSVGBatch(
      [{ component: TestSVG }, { component: TestSVG }],
      { minify: true }
    );

    expect(result.split('\n').length).toBeGreaterThan(1);
  });
});

describe('SSR Render - createServerSVG', () => {
  it('should create server-safe component wrapper', () => {
    const ClientSVG: Component<{ size: number }> = (props) => () => ({
      type: 'svg',
      props: { width: props.size },
    });

    const ServerSVG = createServerSVG(ClientSVG);
    const result = ServerSVG({ size: 100 });

    expect(typeof result).toBe('function');
  });

  it('should accept ssrConfig prop', () => {
    const TestSVG: Component = () => () => ({ type: 'svg', props: {} });
    const ServerSVG = createServerSVG(TestSVG);

    const renderFn = ServerSVG({
      ssrConfig: { minify: true },
    });

    const result = typeof renderFn === 'function' ? renderFn() : renderFn;
    expect(typeof result).toBe('string');
  });
});

describe('SSR Render - Pretty Printing', () => {
  it('should pretty print when requested', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        children: [
          { type: 'circle', props: { r: 5 } },
          { type: 'rect', props: { width: 10 } },
        ],
      },
    });

    const result = renderSVGToString(TestSVG, {}, { pretty: true });
    expect(result).toContain('\n');
  });

  it('should not pretty print when minified', () => {
    const TestSVG: Component = () => () => ({
      type: 'svg',
      props: {
        children: { type: 'circle', props: { r: 5 } },
      },
    });

    const result = renderSVGToString(TestSVG, {}, { pretty: true, minify: true });
    expect(result).not.toContain('\n');
  });
});

describe('SSR Render - Edge Cases', () => {
  it('should handle deeply nested structures', () => {
    const DeepSVG: Component = () => () => ({
      type: 'svg',
      props: {
        children: {
          type: 'g',
          props: {
            children: {
              type: 'g',
              props: {
                children: { type: 'circle', props: { r: 5 } },
              },
            },
          },
        },
      },
    });

    const result = renderSVGToString(DeepSVG);
    expect(result).toContain('<g');
    expect(result).toContain('<circle');
  });

  it('should handle mixed children types', () => {
    const MixedSVG: Component = () => () => ({
      type: 'svg',
      props: {
        children: [
          'Text content',
          { type: 'circle', props: { r: 5 } },
          42,
          null,
          undefined,
        ],
      },
    });

    const result = renderSVGToString(MixedSVG);
    expect(result).toContain('Text content');
    expect(result).toContain('<circle');
    expect(result).toContain('42');
  });
});
