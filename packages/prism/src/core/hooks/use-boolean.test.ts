/**
 * useBoolean Hook Tests
 *
 * Tests for boolean state management hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBoolean } from './use-boolean.js';

describe('useBoolean', () => {
  describe('initialization', () => {
    it('should default to false when no initial value provided', () => {
      const { result } = renderHook(() => useBoolean());
      expect(result.current.value).toBe(false);
    });

    it('should accept initial value of true', () => {
      const { result } = renderHook(() => useBoolean(true));
      expect(result.current.value).toBe(true);
    });

    it('should accept initial value of false', () => {
      const { result } = renderHook(() => useBoolean(false));
      expect(result.current.value).toBe(false);
    });
  });

  describe('onTrue', () => {
    it('should set value to true when called', () => {
      const { result } = renderHook(() => useBoolean(false));

      act(() => {
        result.current.onTrue();
      });

      expect(result.current.value).toBe(true);
    });

    it('should keep value true if already true', () => {
      const { result } = renderHook(() => useBoolean(true));

      act(() => {
        result.current.onTrue();
      });

      expect(result.current.value).toBe(true);
    });
  });

  describe('onFalse', () => {
    it('should set value to false when called', () => {
      const { result } = renderHook(() => useBoolean(true));

      act(() => {
        result.current.onFalse();
      });

      expect(result.current.value).toBe(false);
    });

    it('should keep value false if already false', () => {
      const { result } = renderHook(() => useBoolean(false));

      act(() => {
        result.current.onFalse();
      });

      expect(result.current.value).toBe(false);
    });
  });

  describe('onToggle', () => {
    it('should toggle from false to true', () => {
      const { result } = renderHook(() => useBoolean(false));

      act(() => {
        result.current.onToggle();
      });

      expect(result.current.value).toBe(true);
    });

    it('should toggle from true to false', () => {
      const { result } = renderHook(() => useBoolean(true));

      act(() => {
        result.current.onToggle();
      });

      expect(result.current.value).toBe(false);
    });

    it('should toggle multiple times correctly', () => {
      const { result } = renderHook(() => useBoolean(false));

      act(() => {
        result.current.onToggle();
      });
      expect(result.current.value).toBe(true);

      act(() => {
        result.current.onToggle();
      });
      expect(result.current.value).toBe(false);

      act(() => {
        result.current.onToggle();
      });
      expect(result.current.value).toBe(true);
    });
  });

  describe('setValue', () => {
    it('should set value to true', () => {
      const { result } = renderHook(() => useBoolean(false));

      act(() => {
        result.current.setValue(true);
      });

      expect(result.current.value).toBe(true);
    });

    it('should set value to false', () => {
      const { result } = renderHook(() => useBoolean(true));

      act(() => {
        result.current.setValue(false);
      });

      expect(result.current.value).toBe(false);
    });
  });

  describe('function identity', () => {
    it('should maintain stable function references across re-renders', () => {
      const { result, rerender } = renderHook(() => useBoolean(false));

      const initialOnTrue = result.current.onTrue;
      const initialOnFalse = result.current.onFalse;
      const initialOnToggle = result.current.onToggle;

      rerender();

      expect(result.current.onTrue).toBe(initialOnTrue);
      expect(result.current.onFalse).toBe(initialOnFalse);
      expect(result.current.onToggle).toBe(initialOnToggle);
    });
  });
});
