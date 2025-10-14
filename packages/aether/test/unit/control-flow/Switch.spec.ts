/**
 * Tests for Switch/Match components
 */

import { describe, it, expect } from 'vitest';
import { Switch, Match } from '../../../src/control-flow/Switch';
import { signal } from '../../../src/core/reactivity/signal';

describe('Switch', () => {
  it('should render first matching condition', () => {
    const status = signal('loading');

    const result = Switch({
      children: [
        Match({ when: status() === 'loading', children: 'Loading...' }),
        Match({ when: status() === 'success', children: 'Success!' }),
      ],
    });

    expect(result).toBe('Loading...');
  });

  it('should render fallback when no match', () => {
    const status = signal('unknown');

    const result = Switch({
      children: [
        Match({ when: status() === 'loading', children: 'Loading...' }),
        Match({ when: status() === 'success', children: 'Success!' }),
      ],
      fallback: 'Unknown status',
    });

    expect(result).toBe('Unknown status');
  });

  it('should return null when no match and no fallback', () => {
    const status = signal('unknown');

    const result = Switch({
      children: [
        Match({ when: status() === 'loading', children: 'Loading...' }),
        Match({ when: status() === 'success', children: 'Success!' }),
      ],
    });

    expect(result).toBeNull();
  });

  it('should render only first match when multiple conditions are true', () => {
    const value = signal(5);

    const result = Switch({
      children: [
        Match({ when: value() > 0, children: 'Positive' }),
        Match({ when: value() < 10, children: 'Less than 10' }),
      ],
    });

    expect(result).toBe('Positive');
  });

  it('should handle single Match child', () => {
    const status = signal('success');

    const result = Switch({
      children: Match({ when: status() === 'success', children: 'Success!' }),
    });

    expect(result).toBe('Success!');
  });

  it('should handle falsy conditions correctly', () => {
    const result = Switch({
      children: [
        Match({ when: false, children: 'False' }),
        Match({ when: null, children: 'Null' }),
        Match({ when: undefined, children: 'Undefined' }),
        Match({ when: 0, children: 'Zero' }),
        Match({ when: '', children: 'Empty' }),
        Match({ when: true, children: 'True' }),
      ],
    });

    expect(result).toBe('True');
  });

  it('should handle complex expressions', () => {
    const user = signal<{ role: string } | null>({ role: 'admin' });

    const result = Switch({
      children: [
        Match({ when: user()?.role === 'admin', children: 'Admin Panel' }),
        Match({ when: user()?.role === 'user', children: 'User Panel' }),
        Match({ when: !user(), children: 'Please login' }),
      ],
    });

    expect(result).toBe('Admin Panel');
  });
});

describe('Match', () => {
  it('should return descriptor object', () => {
    const result = Match({ when: true, children: 'Content' });
    expect(result).toEqual({
      type: 'match',
      props: { when: true, children: 'Content' },
    });
  });

  it('should preserve all props in descriptor', () => {
    const result = Match({
      when: false,
      children: 'Function result',
    });
    expect(result).toEqual({
      type: 'match',
      props: { when: false, children: 'Function result' },
    });
  });
});
