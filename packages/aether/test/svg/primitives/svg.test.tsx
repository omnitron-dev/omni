/**
 * Tests for SVG base element
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SVG } from '../../../src/svg/primitives/svg';
import { createSignal } from '../../../src/core/reactivity/signal';
import { render, cleanup } from '../../test-utils';

describe('SVG Primitive', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render basic SVG element', () => {
    const { container } = render(() => (
      <SVG width={100} height={100}>
        <rect x="0" y="0" width="100" height="100" fill="red" />
      </SVG>
    ));

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('width')).toBe('100');
    expect(svg?.getAttribute('height')).toBe('100');

    const rect = svg?.querySelector('rect');
    expect(rect).toBeTruthy();
    expect(rect?.getAttribute('fill')).toBe('red');
  });

  it('should support reactive width and height', () => {
    const [width, setWidth] = createSignal(100);
    const [height, setHeight] = createSignal(100);

    const { container } = render(() => (
      <SVG width={width} height={height} />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('100');
    expect(svg?.getAttribute('height')).toBe('100');

    setWidth(200);
    setHeight(150);

    // Wait for next tick
    setTimeout(() => {
      expect(svg?.getAttribute('width')).toBe('200');
      expect(svg?.getAttribute('height')).toBe('150');
    }, 0);
  });

  it('should support viewBox attribute', () => {
    const { container } = render(() => (
      <SVG width={100} height={100} viewBox="0 0 200 200" />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 200');
  });

  it('should support reactive viewBox', () => {
    const [viewBox, setViewBox] = createSignal('0 0 100 100');

    const { container } = render(() => (
      <SVG width={100} height={100} viewBox={viewBox} />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 100');

    setViewBox('0 0 200 200');

    setTimeout(() => {
      expect(svg?.getAttribute('viewBox')).toBe('0 0 200 200');
    }, 0);
  });

  it('should support className and style', () => {
    const { container } = render(() => (
      <SVG
        width={100}
        height={100}
        className="test-svg"
        style={{ border: '1px solid black' }}
      />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('test-svg')).toBe(true);
    expect(svg?.style.border).toBe('1px solid black');
  });

  it('should support accessibility attributes', () => {
    const { container } = render(() => (
      <SVG
        width={100}
        height={100}
        role="img"
        aria-label="Test SVG"
        aria-labelledby="svg-title"
        aria-describedby="svg-desc"
        title="SVG Title"
        desc="SVG Description"
      />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Test SVG');
    expect(svg?.getAttribute('aria-labelledby')).toBe('svg-title');
    expect(svg?.getAttribute('aria-describedby')).toBe('svg-desc');

    const title = svg?.querySelector('title');
    expect(title?.textContent).toBe('SVG Title');

    const desc = svg?.querySelector('desc');
    expect(desc?.textContent).toBe('SVG Description');
  });

  it('should handle numeric dimensions', () => {
    const { container } = render(() => (
      <SVG width={200} height={150} />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('200');
    expect(svg?.getAttribute('height')).toBe('150');
  });

  it('should handle string dimensions', () => {
    const { container } = render(() => (
      <SVG width="100%" height="50vh" />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('100%');
    expect(svg?.getAttribute('height')).toBe('50vh');
  });

  it('should support preserveAspectRatio', () => {
    const { container } = render(() => (
      <SVG
        width={100}
        height={100}
        viewBox="0 0 200 200"
        preserveAspectRatio="xMidYMid meet"
      />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('should render placeholder when lazy and not visible', () => {
    const placeholder = <div className="placeholder">Loading...</div>;

    const { container } = render(() => (
      <SVG width={100} height={100} lazy={true} placeholder={placeholder}>
        <rect width="100" height="100" fill="blue" />
      </SVG>
    ));

    // Should render placeholder initially
    const placeholderDiv = container.querySelector('.placeholder');
    expect(placeholderDiv).toBeTruthy();
    expect(placeholderDiv?.textContent).toBe('Loading...');

    // SVG should not be rendered yet
    const svg = container.querySelector('svg');
    expect(svg).toBeFalsy();
  });

  it('should render default placeholder when lazy without custom placeholder', () => {
    const { container } = render(() => (
      <SVG width={100} height={100} lazy={true}>
        <rect width="100" height="100" fill="blue" />
      </SVG>
    ));

    // Should render a div with dimensions
    const placeholder = container.querySelector('div');
    expect(placeholder).toBeTruthy();
    expect(placeholder?.style.width).toBe('100px');
    expect(placeholder?.style.height).toBe('100px');
  });

  it('should pass through other SVG attributes', () => {
    const onClick = vi.fn();

    const { container } = render(() => (
      <SVG
        width={100}
        height={100}
        onClick={onClick}
        fill="blue"
        stroke="red"
        strokeWidth="2"
      />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('fill')).toBe('blue');
    expect(svg?.getAttribute('stroke')).toBe('red');
    expect(svg?.getAttribute('stroke-width')).toBe('2');

    svg?.dispatchEvent(new MouseEvent('click'));
    expect(onClick).toHaveBeenCalled();
  });

  it('should handle children correctly', () => {
    const { container } = render(() => (
      <SVG width={100} height={100}>
        <circle cx="50" cy="50" r="40" fill="green" />
        <rect x="10" y="10" width="30" height="30" fill="blue" />
      </SVG>
    ));

    const svg = container.querySelector('svg');
    const circle = svg?.querySelector('circle');
    const rect = svg?.querySelector('rect');

    expect(circle).toBeTruthy();
    expect(circle?.getAttribute('cx')).toBe('50');
    expect(circle?.getAttribute('fill')).toBe('green');

    expect(rect).toBeTruthy();
    expect(rect?.getAttribute('x')).toBe('10');
    expect(rect?.getAttribute('fill')).toBe('blue');
  });

  it('should auto-set role="img" when aria-label is provided', () => {
    const { container } = render(() => (
      <SVG width={100} height={100} aria-label="Icon" />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
  });

  it('should not override explicit role', () => {
    const { container } = render(() => (
      <SVG width={100} height={100} aria-label="Icon" role="presentation" />
    ));

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('presentation');
  });
});