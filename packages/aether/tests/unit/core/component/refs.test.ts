/**
 * Component Refs Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRef,
  useRef,
  reactiveRef,
  mergeRefs,
} from '../../../../src/core/component/refs.js';
import { effect } from '../../../../src/core/reactivity/effect.js';

describe('Component Refs', () => {
  describe('createRef', () => {
    it('should create a ref with undefined initial value', () => {
      const ref = createRef();

      expect(ref.current).toBeUndefined();
    });

    it('should create a ref with initial value', () => {
      const ref = createRef<number>(42);

      expect(ref.current).toBe(42);
    });

    it('should be mutable', () => {
      const ref = createRef<number>(0);

      ref.current = 10;
      expect(ref.current).toBe(10);

      ref.current = 20;
      expect(ref.current).toBe(20);
    });

    it('should handle object values', () => {
      const ref = createRef<{ name: string }>({ name: 'Alice' });

      expect(ref.current?.name).toBe('Alice');

      ref.current = { name: 'Bob' };
      expect(ref.current.name).toBe('Bob');
    });

    it('should handle null and undefined', () => {
      const ref = createRef<string | null>(null);

      expect(ref.current).toBeNull();

      ref.current = undefined;
      expect(ref.current).toBeUndefined();

      ref.current = 'value';
      expect(ref.current).toBe('value');
    });

    it('should not trigger reactivity on changes', () => {
      const ref = createRef(0);
      const fn = vi.fn();

      effect(() => {
        fn(ref.current);
      });

      // Initial run
      expect(fn).toHaveBeenCalledTimes(1);

      // Changing ref should not trigger effect again
      ref.current = 10;
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('useRef', () => {
    it('should be an alias for createRef', () => {
      const ref1 = useRef<number>(42);
      const ref2 = createRef<number>(42);

      expect(ref1.current).toBe(ref2.current);
      expect(typeof ref1).toBe(typeof ref2);
    });

    it('should work identically to createRef', () => {
      const ref = useRef<string>('hello');

      expect(ref.current).toBe('hello');

      ref.current = 'world';
      expect(ref.current).toBe('world');
    });
  });

  describe('reactiveRef', () => {
    it('should create a reactive ref', () => {
      const ref = reactiveRef(0);

      expect(ref.current).toBe(0);
    });

    it('should trigger reactivity on changes', () => {
      const ref = reactiveRef(0);
      const fn = vi.fn();

      effect(() => {
        fn(ref.current);
      });

      // Initial run
      expect(fn).toHaveBeenCalledWith(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Changing ref should trigger effect
      ref.current = 10;
      expect(fn).toHaveBeenCalledWith(10);
      expect(fn).toHaveBeenCalledTimes(2);

      ref.current = 20;
      expect(fn).toHaveBeenCalledWith(20);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should support getter', () => {
      const ref = reactiveRef(42);

      expect(ref.current).toBe(42);
    });

    it('should support setter', () => {
      const ref = reactiveRef(0);

      ref.current = 100;
      expect(ref.current).toBe(100);
    });

    it('should handle object values', () => {
      const ref = reactiveRef({ count: 0 });
      const fn = vi.fn();

      effect(() => {
        fn(ref.current.count);
      });

      expect(fn).toHaveBeenCalledWith(0);
      expect(fn).toHaveBeenCalledTimes(1);

      // Replacing entire object
      ref.current = { count: 10 };
      expect(fn).toHaveBeenCalledWith(10);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not trigger on same value', () => {
      const ref = reactiveRef(42);
      const fn = vi.fn();

      effect(() => {
        fn(ref.current);
      });

      expect(fn).toHaveBeenCalledTimes(1);

      // Setting to same value should not trigger
      ref.current = 42;
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should work with different types', () => {
      const stringRef = reactiveRef('hello');
      const numberRef = reactiveRef(42);
      const boolRef = reactiveRef(true);
      const objectRef = reactiveRef({ x: 1 });

      expect(stringRef.current).toBe('hello');
      expect(numberRef.current).toBe(42);
      expect(boolRef.current).toBe(true);
      expect(objectRef.current.x).toBe(1);
    });
  });

  describe('mergeRefs', () => {
    it('should merge multiple refs', () => {
      const ref1 = createRef<number>();
      const ref2 = createRef<number>();
      const ref3 = createRef<number>();

      const merged = mergeRefs([ref1, ref2, ref3]);

      merged(42);

      expect(ref1.current).toBe(42);
      expect(ref2.current).toBe(42);
      expect(ref3.current).toBe(42);
    });

    it('should handle undefined refs', () => {
      const ref1 = createRef<number>();
      const ref2 = createRef<number>();

      const merged = mergeRefs([ref1, undefined, ref2, null]);

      expect(() => merged(42)).not.toThrow();
      expect(ref1.current).toBe(42);
      expect(ref2.current).toBe(42);
    });

    it('should handle empty array', () => {
      const merged = mergeRefs<number>([]);

      expect(() => merged(42)).not.toThrow();
    });

    it('should handle single ref', () => {
      const ref = createRef<string>();
      const merged = mergeRefs([ref]);

      merged('hello');

      expect(ref.current).toBe('hello');
    });

    it('should update all refs on each call', () => {
      const ref1 = createRef<number>();
      const ref2 = createRef<number>();

      const merged = mergeRefs([ref1, ref2]);

      merged(10);
      expect(ref1.current).toBe(10);
      expect(ref2.current).toBe(10);

      merged(20);
      expect(ref1.current).toBe(20);
      expect(ref2.current).toBe(20);
    });

    it('should work with DOM element pattern', () => {
      const localRef = createRef<HTMLElement>();
      const forwardedRef = createRef<HTMLElement>();

      const merged = mergeRefs([localRef, forwardedRef]);

      // Simulate assigning a DOM element
      const element = { tagName: 'DIV' } as any as HTMLElement;
      merged(element);

      expect(localRef.current).toBe(element);
      expect(forwardedRef.current).toBe(element);
    });

    it('should work with reactive refs', () => {
      const ref1 = reactiveRef<number | undefined>(undefined);
      const ref2 = createRef<number>();

      // Create merged callback
      const merged = mergeRefs([
        { current: undefined } as any,
        ref2,
      ]);

      merged(42);

      expect(ref2.current).toBe(42);
    });
  });

  describe('Ref patterns', () => {
    it('should support DOM ref pattern', () => {
      const inputRef = createRef<HTMLInputElement>();

      // Simulate assigning DOM element
      const input = {
        tagName: 'INPUT',
        focus: vi.fn(),
        value: '',
      } as any as HTMLInputElement;

      inputRef.current = input;

      expect(inputRef.current?.tagName).toBe('INPUT');
      inputRef.current?.focus();
      expect(input.focus).toHaveBeenCalled();
    });

    it('should support ref forwarding pattern', () => {
      const parentRef = createRef<HTMLElement>();
      const childRef = createRef<HTMLElement>();

      const element = { tagName: 'DIV' } as any as HTMLElement;

      // Child assigns to its local ref
      childRef.current = element;

      // Forward to parent ref
      parentRef.current = childRef.current;

      expect(parentRef.current).toBe(element);
      expect(childRef.current).toBe(element);
    });

    it('should support callback ref pattern', () => {
      const refs: any[] = [];
      const callbackRef = (element: any) => {
        refs.push(element);
      };

      const element1 = { id: 1 };
      const element2 = { id: 2 };

      callbackRef(element1);
      callbackRef(element2);

      expect(refs).toEqual([element1, element2]);
    });

    it('should support imperative handle pattern', () => {
      interface Handle {
        focus: () => void;
        reset: () => void;
      }

      const handleRef = createRef<Handle>();

      const handle: Handle = {
        focus: vi.fn(),
        reset: vi.fn(),
      };

      handleRef.current = handle;

      handleRef.current?.focus();
      handleRef.current?.reset();

      expect(handle.focus).toHaveBeenCalled();
      expect(handle.reset).toHaveBeenCalled();
    });

    it('should support reactive value tracking', () => {
      const ref = reactiveRef(0);
      const values: number[] = [];

      effect(() => {
        values.push(ref.current);
      });

      ref.current = 1;
      ref.current = 2;
      ref.current = 3;

      expect(values).toEqual([0, 1, 2, 3]);
    });
  });

  describe('Type safety', () => {
    it('should enforce ref types', () => {
      const stringRef = createRef<string>();
      const numberRef = createRef<number>();

      stringRef.current = 'hello';
      numberRef.current = 42;

      expect(typeof stringRef.current).toBe('string');
      expect(typeof numberRef.current).toBe('number');
    });

    it('should support optional types', () => {
      const ref = createRef<string | undefined>();

      expect(ref.current).toBeUndefined();

      ref.current = 'value';
      expect(ref.current).toBe('value');

      ref.current = undefined;
      expect(ref.current).toBeUndefined();
    });

    it('should support union types', () => {
      const ref = createRef<string | number>();

      ref.current = 'text';
      expect(ref.current).toBe('text');

      ref.current = 123;
      expect(ref.current).toBe(123);
    });
  });

  describe('Performance', () => {
    it('should handle many ref updates efficiently', () => {
      const ref = createRef(0);

      for (let i = 0; i < 1000; i++) {
        ref.current = i;
      }

      expect(ref.current).toBe(999);
    });

    it('should handle many reactive ref updates efficiently', () => {
      const ref = reactiveRef(0);
      let count = 0;

      effect(() => {
        count = ref.current;
      });

      for (let i = 0; i < 100; i++) {
        ref.current = i;
      }

      expect(count).toBe(99);
    });

    it('should not leak memory with merged refs', () => {
      const refs = Array.from({ length: 100 }, () => createRef<number>());
      const merged = mergeRefs(refs);

      merged(42);

      refs.forEach((ref) => {
        expect(ref.current).toBe(42);
      });
    });
  });
});
