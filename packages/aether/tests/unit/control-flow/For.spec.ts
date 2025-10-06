/**
 * Tests for For component
 */

import { describe, it, expect } from 'vitest';
import { For } from '../../../src/control-flow/For';
import { signal } from '../../../src/core/reactivity/signal';

describe('For', () => {
  it('should render items', () => {
    const items = signal([1, 2, 3]);
    const result = For({
      each: items(),
      children: (item: number) => item * 2,
    });
    expect(result).toEqual([2, 4, 6]);
  });

  it('should pass index to children', () => {
    const items = signal(['a', 'b', 'c']);
    const result = For({
      each: items(),
      children: (item: string, index: number) => `${index}: ${item}`,
    });
    expect(result).toEqual(['0: a', '1: b', '2: c']);
  });

  it('should render fallback for empty array', () => {
    const items = signal<number[]>([]);
    const result = For({
      each: items(),
      fallback: 'No items',
      children: (item: number) => item,
    });
    expect(result).toBe('No items');
  });

  it('should render fallback for undefined', () => {
    const items = signal<number[] | undefined>(undefined);
    const result = For({
      each: items(),
      fallback: 'No items',
      children: (item: number) => item,
    });
    expect(result).toBe('No items');
  });

  it('should render fallback for null', () => {
    const items = signal<number[] | null>(null);
    const result = For({
      each: items(),
      fallback: 'No items',
      children: (item: number) => item,
    });
    expect(result).toBe('No items');
  });

  it('should return null when empty and no fallback', () => {
    const items = signal<number[]>([]);
    const result = For({
      each: items(),
      children: (item: number) => item,
    });
    expect(result).toBeNull();
  });

  it('should handle complex objects', () => {
    interface Todo {
      id: number;
      text: string;
      done: boolean;
    }

    const todos = signal<Todo[]>([
      { id: 1, text: 'Learn Aether', done: false },
      { id: 2, text: 'Build app', done: true },
    ]);

    const result = For({
      each: todos(),
      children: (todo: Todo) => ({ id: todo.id, text: todo.text }),
    });
    expect(result).toEqual([
      { id: 1, text: 'Learn Aether' },
      { id: 2, text: 'Build app' },
    ]);
  });

  it('should handle single item array', () => {
    const items = signal([42]);
    const result = For({
      each: items(),
      children: (item: number) => item * 2,
    });
    expect(result).toEqual([84]);
  });

  it('should handle nested arrays', () => {
    const items = signal([[1, 2], [3, 4]]);
    const result = For({
      each: items(),
      children: (item: number[]) => item.reduce((a, b) => a + b, 0),
    });
    expect(result).toEqual([3, 7]);
  });
});
