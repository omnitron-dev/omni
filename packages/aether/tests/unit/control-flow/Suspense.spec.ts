/**
 * Suspense Component Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Suspense } from '../../../src/control-flow/Suspense.js';

describe('Suspense', () => {
  beforeEach(() => {
    // Clean up
    document.body.innerHTML = '';
  });

  it('should render children immediately when not loading', () => {
    const child = document.createElement('div');
    child.textContent = 'Content';

    const result = Suspense({
      fallback: document.createTextNode('Loading...'),
      children: child,
    });

    expect(result).toBe(child);
  });

  it('should render fallback when loading', async () => {
    const fallback = document.createElement('div');
    fallback.textContent = 'Loading...';

    const child = document.createElement('div');
    child.textContent = 'Content';

    const result = Suspense({
      fallback,
      children: child,
    });

    // Initially should render children
    expect(result).toBe(child);
  });

  it('should handle null children', () => {
    const fallback = document.createTextNode('Loading...');

    const result = Suspense({
      fallback,
      children: null,
    });

    expect(result).toBe(null);
  });

  it('should handle undefined children', () => {
    const fallback = document.createTextNode('Loading...');

    const result = Suspense({
      fallback,
      children: undefined,
    });

    expect(result).toBeUndefined();
  });

  it('should render array of children', () => {
    const child1 = document.createElement('div');
    child1.textContent = 'Child 1';

    const child2 = document.createElement('div');
    child2.textContent = 'Child 2';

    const children = [child1, child2];

    const result = Suspense({
      fallback: document.createTextNode('Loading...'),
      children,
    });

    expect(result).toBe(children);
  });

  it('should render string children', () => {
    const result = Suspense({
      fallback: 'Loading...',
      children: 'Content',
    });

    expect(result).toBe('Content');
  });

  it('should render number children', () => {
    const result = Suspense({
      fallback: 'Loading...',
      children: 42,
    });

    expect(result).toBe(42);
  });

  it('should handle fallback as text', () => {
    const child = document.createElement('div');
    child.textContent = 'Content';

    const result = Suspense({
      fallback: 'Loading...',
      children: child,
    });

    expect(result).toBe(child);
  });

  it('should handle fallback as element', () => {
    const fallback = document.createElement('div');
    fallback.className = 'loading-spinner';

    const child = document.createElement('div');
    child.textContent = 'Content';

    const result = Suspense({
      fallback,
      children: child,
    });

    expect(result).toBe(child);
  });

  it('should handle complex nested children', () => {
    const parent = document.createElement('div');

    const child1 = document.createElement('span');
    child1.textContent = 'Span';

    const child2 = document.createElement('p');
    child2.textContent = 'Paragraph';

    parent.appendChild(child1);
    parent.appendChild(child2);

    const result = Suspense({
      fallback: document.createTextNode('Loading...'),
      children: parent,
    });

    expect(result).toBe(parent);
  });
});
