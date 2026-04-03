/**
 * Mock for @kysera/debug
 */

import { vi } from 'vitest';

export const withDebug = vi.fn().mockImplementation((db, options = {}) => db);

export const formatSQL = vi.fn().mockImplementation((sql) => sql);

export class QueryProfiler {
  constructor(options: any = {}) {}

  start(): void {}
  stop(): void {}
  getMetrics(): any {
    return {
      queryCount: 0,
      totalTime: 0,
      slowQueries: [],
    };
  }
}

export const formatSQLPretty = vi.fn().mockImplementation((sql) => sql);
export const minifySQL = vi.fn().mockImplementation((sql) => sql.replace(/\s+/g, ' ').trim());
export const highlightSQL = vi.fn().mockImplementation((sql) => sql);

export class CircularBuffer<T> {
  private items: T[] = [];
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  toArray(): T[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}
