import { vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  class MockIntersectionObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  (window as any).IntersectionObserver = MockIntersectionObserver;
}
