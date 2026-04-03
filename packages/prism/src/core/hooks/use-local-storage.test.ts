/**
 * useLocalStorage Hook Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalStorage, useReadLocalStorage } from './use-local-storage.js';

describe('useLocalStorage', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('should initialize with default value when localStorage is empty', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('default');
  });

  it('should initialize with stored value from localStorage', () => {
    localStorage.setItem('test-key', JSON.stringify('stored-value'));

    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('stored-value');
  });

  it('should update value and persist to localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'));

    act(() => {
      result.current[1]('updated');
    });

    expect(result.current[0]).toBe('updated');
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('updated'));
  });

  it('should support updater function for setValue', () => {
    const { result } = renderHook(() => useLocalStorage('counter', 0));

    act(() => {
      result.current[1]((prev) => prev + 1);
    });
    expect(result.current[0]).toBe(1);

    act(() => {
      result.current[1]((prev) => prev + 5);
    });
    expect(result.current[0]).toBe(6);
    expect(localStorage.getItem('counter')).toBe('6');
  });

  it('should remove value from storage with removeValue', () => {
    localStorage.setItem('test-key', JSON.stringify('stored'));

    const { result } = renderHook(() => useLocalStorage('test-key', 'default'));
    expect(result.current[0]).toBe('stored');

    act(() => {
      result.current[2](); // removeValue
    });

    expect(result.current[0]).toBe('default');
    expect(localStorage.getItem('test-key')).toBeNull();
  });

  it('should handle invalid JSON in localStorage gracefully', () => {
    localStorage.setItem('test-key', 'invalid-json{');

    const { result } = renderHook(() => useLocalStorage('test-key', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('should work with complex objects', () => {
    interface TestObject {
      name: string;
      count: number;
      nested: { items: number[] };
    }
    const initialValue: TestObject = { name: 'test', count: 0, nested: { items: [] } };
    const { result } = renderHook(() => useLocalStorage<TestObject>('object-key', initialValue));

    expect(result.current[0]).toEqual(initialValue);

    const updatedValue: TestObject = { name: 'updated', count: 5, nested: { items: [1, 2, 3] } };
    act(() => {
      result.current[1](updatedValue);
    });

    expect(result.current[0]).toEqual(updatedValue);
    expect(JSON.parse(localStorage.getItem('object-key')!)).toEqual(updatedValue);
  });

  it('should work with arrays', () => {
    const { result } = renderHook(() => useLocalStorage<string[]>('array-key', []));

    act(() => {
      result.current[1](['a', 'b', 'c']);
    });

    expect(result.current[0]).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(localStorage.getItem('array-key')!)).toEqual(['a', 'b', 'c']);
  });

  it('should return stable references for callbacks', () => {
    const { result, rerender } = renderHook(() => useLocalStorage('test-key', 'value'));

    const [, setValue1, removeValue1] = result.current;

    rerender();

    const [, setValue2, removeValue2] = result.current;

    expect(setValue1).toBe(setValue2);
    expect(removeValue1).toBe(removeValue2);
  });

  it('should handle different keys independently', () => {
    const { result: result1 } = renderHook(() => useLocalStorage('key1', 'default1'));
    const { result: result2 } = renderHook(() => useLocalStorage('key2', 'default2'));

    act(() => {
      result1.current[1]('value1');
    });

    expect(result1.current[0]).toBe('value1');
    expect(result2.current[0]).toBe('default2');
    expect(localStorage.getItem('key1')).toBe(JSON.stringify('value1'));
    expect(localStorage.getItem('key2')).toBeNull();
  });

  it('should handle boolean values', () => {
    const { result } = renderHook(() => useLocalStorage('boolean-key', false));

    expect(result.current[0]).toBe(false);

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem('boolean-key')).toBe('true');
  });

  it('should handle null values', () => {
    const { result } = renderHook(() => useLocalStorage<string | null>('null-key', null));

    expect(result.current[0]).toBeNull();

    act(() => {
      result.current[1]('not-null');
    });
    expect(result.current[0]).toBe('not-null');

    act(() => {
      result.current[1](null);
    });
    expect(result.current[0]).toBeNull();
  });
});

describe('useReadLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return fallback when key does not exist', () => {
    const { result } = renderHook(() => useReadLocalStorage('nonexistent', 'fallback'));
    expect(result.current).toBe('fallback');
  });

  it('should return stored value when key exists', () => {
    localStorage.setItem('read-key', JSON.stringify('stored'));

    const { result } = renderHook(() => useReadLocalStorage('read-key', 'fallback'));
    expect(result.current).toBe('stored');
  });

  it('should return fallback for invalid JSON', () => {
    localStorage.setItem('invalid-key', 'not-valid-json{');

    const { result } = renderHook(() => useReadLocalStorage('invalid-key', 'fallback'));
    expect(result.current).toBe('fallback');
  });

  it('should work with complex objects', () => {
    interface StoredObject {
      name: string;
      items: number[];
    }
    const storedValue: StoredObject = { name: 'test', items: [1, 2, 3] };
    localStorage.setItem('object-key', JSON.stringify(storedValue));

    const { result } = renderHook(() => useReadLocalStorage<StoredObject>('object-key', { name: '', items: [] }));
    expect(result.current).toEqual(storedValue);
  });
});
