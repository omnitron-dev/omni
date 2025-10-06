/**
 * Tests for Show component
 */

import { describe, it, expect } from 'vitest';
import { Show } from '../../../src/control-flow/Show';
import { signal } from '../../../src/core/reactivity/signal';

describe('Show', () => {
  it('should render children when condition is truthy', () => {
    const condition = signal(true);
    const result = Show({ when: condition(), children: 'Content' });
    expect(result).toBe('Content');
  });

  it('should render fallback when condition is falsy', () => {
    const condition = signal(false);
    const result = Show({ when: condition(), fallback: 'Fallback', children: 'Content' });
    expect(result).toBe('Fallback');
  });

  it('should return null when no fallback and condition is falsy', () => {
    const condition = signal(false);
    const result = Show({ when: condition(), children: 'Content' });
    expect(result).toBeNull();
  });

  it('should handle function children', () => {
    const user = signal({ name: 'John' });
    const result = Show({
      when: user(),
      children: (u: any) => `Hello ${u.name}`,
    });
    expect(result).toBe('Hello John');
  });

  it('should handle undefined/null conditions as falsy', () => {
    const resultUndefined = Show({ when: undefined, children: 'Content', fallback: 'Fallback' });
    expect(resultUndefined).toBe('Fallback');

    const resultNull = Show({ when: null, children: 'Content', fallback: 'Fallback' });
    expect(resultNull).toBe('Fallback');
  });

  it('should handle zero as falsy', () => {
    const result = Show({ when: 0, children: 'Content', fallback: 'Fallback' });
    expect(result).toBe('Fallback');
  });

  it('should handle empty string as falsy', () => {
    const result = Show({ when: '', children: 'Content', fallback: 'Fallback' });
    expect(result).toBe('Fallback');
  });

  it('should handle non-empty values as truthy', () => {
    expect(Show({ when: 'text', children: 'Content' })).toBe('Content');
    expect(Show({ when: 1, children: 'Content' })).toBe('Content');
    expect(Show({ when: {}, children: 'Content' })).toBe('Content');
    expect(Show({ when: [], children: 'Content' })).toBe('Content');
  });
});
