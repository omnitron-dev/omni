/**
 * Toast Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastContext,
  type ToastData,
} from '../../../src/primitives/Toast.js';
import { renderComponent } from '../../helpers/test-utils.js';
import { useContext } from '../../../src/core/component/context.js';
import { defineComponent } from '../../../src/core/component/define.js';

describe('ToastProvider', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render children', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: 'Content',
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Content');
    });

    it('should provide context to children', () => {
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 0');
    });
  });

  describe('Context Values', () => {
    it('should have default maxToasts of 3', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        return () => `Max: ${ctx.maxToasts}`;
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(ctx.maxToasts).toBe(3);
    });

    it('should use custom maxToasts', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        return () => '';
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          maxToasts: 5,
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(ctx.maxToasts).toBe(5);
    });

    it('should have default duration of 5000', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        return () => '';
      });

      const App = defineComponent(() => {
        return () => ToastProvider({
          children: () => TestComponent({}),
        });
      });

      const { cleanup: dispose } = renderComponent(() => App({}));
      cleanup = dispose;

      expect(ctx.duration).toBe(5000);
    });

    it('should use custom duration', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        return () => '';
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          duration: 3000,
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(ctx.duration).toBe(3000);
    });
  });

  describe('Adding Toasts', () => {
    it('should add toast to context', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test' });
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 1');
    });

    it('should return toast ID', () => {
      let toastId: string;
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        toastId = ctx.addToast({ title: 'Test' });
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(toastId).toMatch(/^toast-/);
    });

    it('should generate unique IDs for toasts', () => {
      const ids: string[] = [];
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        ids.push(ctx.addToast({ title: 'Test 1' }));
        ids.push(ctx.addToast({ title: 'Test 2' }));
        ids.push(ctx.addToast({ title: 'Test 3' }));
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(new Set(ids).size).toBe(3);
      expect(ids.every((id) => id.startsWith('toast-'))).toBe(true);
    });

    it('should add toast with all properties', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({
          title: 'Success',
          description: 'Operation completed',
          variant: 'success',
          duration: 2000,
        });
        return () => {
          const toasts = ctx.toasts();
          if (toasts.length === 0) return '';
          const toast = toasts[0];
          return `${toast.title}|${toast.description}|${toast.variant}|${toast.duration}`;
        };
      });

      const {  cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const toast = ctx.toasts()[0];
      expect(toast.title).toBe('Success');
      expect(toast.description).toBe('Operation completed');
      expect(toast.variant).toBe('success');
      expect(toast.duration).toBe(2000);
    });

    it('should use default duration if not specified', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test' });
        return () => '';
      });

      const App = defineComponent(() => {
        return () => ToastProvider({
          duration: 3000,
          children: () => TestComponent({}),
        });
      });

      const { cleanup: dispose } = renderComponent(() => App({}));
      cleanup = dispose;

      const toast = ctx.toasts()[0];
      expect(toast.duration).toBe(3000);
    });

    it('should override provider duration with toast duration', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test', duration: 1000 });
        return () => '';
      });

      const App = defineComponent(() => {
        return () => ToastProvider({
          duration: 3000,
          children: () => TestComponent({}),
        });
      });

      const { cleanup: dispose } = renderComponent(() => App({}));
      cleanup = dispose;

      const toast = ctx.toasts()[0];
      expect(toast.duration).toBe(1000);
    });
  });

  describe('Removing Toasts', () => {
    it('should remove toast by ID', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        const id = ctx.addToast({ title: 'Test' });
        ctx.removeToast(id);
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 0');
    });

    it('should only remove specified toast', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        const id1 = ctx.addToast({ title: 'Test 1' });
        ctx.addToast({ title: 'Test 2' });
        ctx.addToast({ title: 'Test 3' });
        ctx.removeToast(id1);
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 2');
    });

    it('should handle removing non-existent toast', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test' });
        ctx.removeToast('non-existent-id');
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 1');
    });
  });

  describe('MaxToasts Limit', () => {
    it('should limit toasts to maxToasts', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Toast 1' });
        ctx.addToast({ title: 'Toast 2' });
        ctx.addToast({ title: 'Toast 3' });
        ctx.addToast({ title: 'Toast 4' }); // Should remove first
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          maxToasts: 3,
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 3');
    });

    it('should remove oldest toasts when exceeding limit', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Toast 1' });
        ctx.addToast({ title: 'Toast 2' });
        ctx.addToast({ title: 'Toast 3' });
        ctx.addToast({ title: 'Toast 4' });
        return () => {
          const titles = ctx.toasts().map((t: any) => t.title);
          return `Titles: ${titles.join(', ')}`;
        };
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          maxToasts: 3,
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Titles: Toast 2, Toast 3, Toast 4');
    });

    it('should handle maxToasts=1', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Toast 1' });
        ctx.addToast({ title: 'Toast 2' });
        return () => '';
      });

      const App = defineComponent(() => {
        return () => ToastProvider({
          maxToasts: 1,
          children: () => TestComponent({}),
        });
      });

      const { cleanup: dispose } = renderComponent(() => App({}));
      cleanup = dispose;

      const toast = ctx.toasts()[0];
      expect(toast.title).toBe('Toast 2');
    });
  });

  describe('Auto-dismiss', () => {
    it('should auto-dismiss toast after duration', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test', duration: 1000 });
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 1');

      vi.advanceTimersByTime(1000);

      expect(container.textContent).toBe('Toasts: 0');
    });

    it('should auto-dismiss multiple toasts independently', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Fast', duration: 500 });
        ctx.addToast({ title: 'Slow', duration: 1500 });
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 2');

      vi.advanceTimersByTime(500);
      expect(container.textContent).toBe('Toasts: 1');

      vi.advanceTimersByTime(1000);
      expect(container.textContent).toBe('Toasts: 0');
    });

    it('should not auto-dismiss when duration is 0', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test', duration: 0 });
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 1');

      vi.advanceTimersByTime(10000);

      expect(container.textContent).toBe('Toasts: 1');
    });

    it('should not auto-dismiss when duration is negative', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test', duration: -1 });
        return () => `Toasts: ${ctx.toasts().length}`;
      });

      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      expect(container.textContent).toBe('Toasts: 1');

      vi.advanceTimersByTime(10000);

      expect(container.textContent).toBe('Toasts: 1');
    });
  });
});

describe('ToastViewport', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
    // Clean up Portal content from document.body
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    // Clean up Portal content from document.body
    document.body.innerHTML = '';
  });

  describe('Rendering', () => {
    it('should render as ordered list inside portal', () => {
      const { container, cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: ToastViewport({}),
        })
      );
      cleanup = dispose;

      // Portal appends to body, not container
      const viewport = document.querySelector('ol[data-toast-viewport]');
      expect(viewport).toBeTruthy();
      expect(viewport?.tagName).toBe('OL');
    });

    it('should have role="region"', () => {
      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: ToastViewport({}),
        })
      );
      cleanup = dispose;

      const viewport = document.querySelector('ol[data-toast-viewport]');
      expect(viewport?.getAttribute('role')).toBe('region');
    });

    it('should have default aria-label', () => {
      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: ToastViewport({}),
        })
      );
      cleanup = dispose;

      const viewport = document.querySelector('ol[data-toast-viewport]');
      expect(viewport?.getAttribute('aria-label')).toBe('Notifications');
    });

    it('should use custom label', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        return ToastViewport({ label: 'Alerts' });
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const viewport = document.querySelector('ol[data-toast-viewport]');
      expect(viewport?.getAttribute('aria-label')).toBe('Alerts');
    });

    it('should have tabIndex=-1', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        return ToastViewport({});
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const viewport = document.querySelector('ol[data-toast-viewport]') as HTMLElement;
      expect(viewport.tabIndex).toBe(-1);
    });

    it('should apply additional props', () => {
      let ctx: any;
      const TestComponent = defineComponent(() => {
        ctx = useContext(ToastContext);
        return ToastViewport({
          'data-testid': 'toast-viewport',
          className: 'custom-viewport',
        });
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const viewport = document.querySelector('ol[data-toast-viewport]');
      expect(viewport?.getAttribute('data-testid')).toBe('toast-viewport');
      expect(viewport?.className).toContain('custom-viewport');
    });
  });

  describe('Rendering Toasts', () => {
    it('should render no toasts initially', () => {
      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: ToastViewport({}),
        })
      );
      cleanup = dispose;

      const toasts = document.querySelectorAll('[data-toast]');
      expect(toasts.length).toBe(0);
    });

    it('should render toasts from context', () => {
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test Toast' });
        return ToastViewport({});
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const toasts = document.querySelectorAll('[data-toast]');
      expect(toasts.length).toBe(1);
    });

    it('should render multiple toasts', () => {
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Toast 1' });
        ctx.addToast({ title: 'Toast 2' });
        ctx.addToast({ title: 'Toast 3' });
        return ToastViewport({});
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const toasts = document.querySelectorAll('[data-toast]');
      expect(toasts.length).toBe(3);
    });
  });

  describe('Hotkey', () => {
    it('should focus first toast on default hotkey (F8)', () => {
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test Toast' });
        return ToastViewport({});
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const firstToast = document.querySelector('[data-toast]') as HTMLElement;
      const focusSpy = vi.spyOn(firstToast, 'focus');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' }));

      expect(focusSpy).toHaveBeenCalled();
    });

    it('should use custom hotkey', () => {
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test Toast' });
        return ToastViewport({ hotkey: 'F9' });
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const firstToast = document.querySelector('[data-toast]') as HTMLElement;
      const focusSpy = vi.spyOn(firstToast, 'focus');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9' }));

      expect(focusSpy).toHaveBeenCalled();
    });

    it('should not focus on wrong hotkey', () => {
      const TestComponent = defineComponent(() => {
        const ctx = useContext(ToastContext);
        ctx.addToast({ title: 'Test Toast' });
        return ToastViewport({});
      });

      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: () => TestComponent({}),
        })
      );
      cleanup = dispose;

      const firstToast = document.querySelector('[data-toast]') as HTMLElement;
      const focusSpy = vi.spyOn(firstToast, 'focus');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7' }));

      expect(focusSpy).not.toHaveBeenCalled();
    });

    it('should handle no toasts when hotkey pressed', () => {
      const { cleanup: dispose } = renderComponent(() =>
        ToastProvider({
          children: ToastViewport({}),
        })
      );
      cleanup = dispose;

      // Should not throw
      expect(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' }));
      }).not.toThrow();
    });
  });
});

describe('Toast', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  describe('Rendering', () => {
    it('should render as list item', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Test',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li[data-toast]');
      expect(li).toBeTruthy();
      expect(li?.tagName).toBe('LI');
    });

    it('should have data-toast attribute', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Test',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.hasAttribute('data-toast')).toBe(true);
    });

    it('should have role="status"', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Test',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('role')).toBe('status');
    });

    it('should have aria-live="polite"', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Test',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('aria-live')).toBe('polite');
    });

    it('should have aria-atomic="true"', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Test',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('aria-atomic')).toBe('true');
    });
  });

  describe('Variants', () => {
    it('should have default variant', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Test',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('data-variant')).toBe('default');
    });

    it('should apply success variant', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Success',
        variant: 'success',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('data-variant')).toBe('success');
    });

    it('should apply error variant', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Error',
        variant: 'error',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('data-variant')).toBe('error');
    });

    it('should apply warning variant', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Warning',
        variant: 'warning',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('data-variant')).toBe('warning');
    });

    it('should apply info variant', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Info',
        variant: 'info',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const li = container.querySelector('li');
      expect(li?.getAttribute('data-variant')).toBe('info');
    });
  });

  describe('Title', () => {
    it('should render title when provided', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Toast Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-toast-title]');
      expect(title).toBeTruthy();
      expect(title?.textContent).toBe('Toast Title');
    });

    it('should not render title element when not provided', () => {
      const toast: ToastData = {
        id: 'test-toast',
        description: 'Only description',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-toast-title]');
      expect(title).toBeNull();
    });

    it('should render title as div', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-toast-title]');
      expect(title?.tagName).toBe('DIV');
    });
  });

  describe('Description', () => {
    it('should render description when provided', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        description: 'This is the description',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const description = container.querySelector('[data-toast-description]');
      expect(description).toBeTruthy();
      expect(description?.textContent).toBe('This is the description');
    });

    it('should not render description element when not provided', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Only title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const description = container.querySelector('[data-toast-description]');
      expect(description).toBeNull();
    });

    it('should render description as div', () => {
      const toast: ToastData = {
        id: 'test-toast',
        description: 'Description',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const description = container.querySelector('[data-toast-description]');
      expect(description?.tagName).toBe('DIV');
    });

    it('should render both title and description', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        description: 'Description',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const title = container.querySelector('[data-toast-title]');
      const description = container.querySelector('[data-toast-description]');
      expect(title).toBeTruthy();
      expect(description).toBeTruthy();
    });
  });

  describe('Action Button', () => {
    it('should render action button when provided', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        action: {
          label: 'Undo',
          onClick: vi.fn(),
        },
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const action = container.querySelector('[data-toast-action]');
      expect(action).toBeTruthy();
      expect(action?.textContent).toBe('Undo');
    });

    it('should not render action button when not provided', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const action = container.querySelector('[data-toast-action]');
      expect(action).toBeNull();
    });

    it('should render action as button', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        action: {
          label: 'Retry',
          onClick: vi.fn(),
        },
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const action = container.querySelector('[data-toast-action]');
      expect(action?.tagName).toBe('BUTTON');
    });

    it('should call action onClick when clicked', () => {
      const onClick = vi.fn();
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        action: {
          label: 'Action',
          onClick,
        },
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const action = container.querySelector('[data-toast-action]') as HTMLButtonElement;
      action.click();

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('should call onDismiss when action clicked', () => {
      const onDismiss = vi.fn();
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        action: {
          label: 'Action',
          onClick: vi.fn(),
        },
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast, onDismiss })
      );
      cleanup = dispose;

      const action = container.querySelector('[data-toast-action]') as HTMLButtonElement;
      action.click();

      expect(onDismiss).toHaveBeenCalledWith('test-toast');
    });

    it('should call both action onClick and onDismiss', () => {
      const onClick = vi.fn();
      const onDismiss = vi.fn();
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        action: {
          label: 'Action',
          onClick,
        },
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast, onDismiss })
      );
      cleanup = dispose;

      const action = container.querySelector('[data-toast-action]') as HTMLButtonElement;
      action.click();

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledWith('test-toast');
    });

    it('should prevent default on action click', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
        action: {
          label: 'Action',
          onClick: vi.fn(),
        },
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const action = container.querySelector('[data-toast-action]') as HTMLButtonElement;
      const event = new MouseEvent('click');
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      action.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Close Button', () => {
    it('should always render close button', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const close = container.querySelector('[data-toast-close]');
      expect(close).toBeTruthy();
    });

    it('should render close button as button', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const close = container.querySelector('[data-toast-close]');
      expect(close?.tagName).toBe('BUTTON');
    });

    it('should have aria-label="Close"', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const close = container.querySelector('[data-toast-close]');
      expect(close?.getAttribute('aria-label')).toBe('Close');
    });

    it('should render × symbol', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const close = container.querySelector('[data-toast-close]');
      expect(close?.textContent).toBe('×');
    });

    it('should call onDismiss when clicked', () => {
      const onDismiss = vi.fn();
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast, onDismiss })
      );
      cleanup = dispose;

      const close = container.querySelector('[data-toast-close]') as HTMLButtonElement;
      close.click();

      expect(onDismiss).toHaveBeenCalledWith('test-toast');
    });

    it('should not throw when onDismiss not provided', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Title',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      const close = container.querySelector('[data-toast-close]') as HTMLButtonElement;

      expect(() => close.click()).not.toThrow();
    });
  });

  describe('Complete Toast', () => {
    it('should render all parts together', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Success',
        description: 'Operation completed successfully',
        variant: 'success',
        action: {
          label: 'View',
          onClick: vi.fn(),
        },
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-toast]')).toBeTruthy();
      expect(container.querySelector('[data-toast-title]')).toBeTruthy();
      expect(container.querySelector('[data-toast-description]')).toBeTruthy();
      expect(container.querySelector('[data-toast-action]')).toBeTruthy();
      expect(container.querySelector('[data-toast-close]')).toBeTruthy();
    });

    it('should render minimal toast with only title', () => {
      const toast: ToastData = {
        id: 'test-toast',
        title: 'Simple toast',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-toast]')).toBeTruthy();
      expect(container.querySelector('[data-toast-title]')).toBeTruthy();
      expect(container.querySelector('[data-toast-description]')).toBeNull();
      expect(container.querySelector('[data-toast-action]')).toBeNull();
      expect(container.querySelector('[data-toast-close]')).toBeTruthy();
    });

    it('should render toast with only description', () => {
      const toast: ToastData = {
        id: 'test-toast',
        description: 'Just a description',
      };

      const { container, cleanup: dispose } = renderComponent(() =>
        Toast({ toast })
      );
      cleanup = dispose;

      expect(container.querySelector('[data-toast]')).toBeTruthy();
      expect(container.querySelector('[data-toast-title]')).toBeNull();
      expect(container.querySelector('[data-toast-description]')).toBeTruthy();
      expect(container.querySelector('[data-toast-close]')).toBeTruthy();
    });
  });
});

describe('Toast Integration', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    cleanup?.();
    cleanup = undefined;
    // Clean up Portal content from document.body
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    // Clean up Portal content from document.body
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('should render toast in viewport', () => {
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      ctx.addToast({ title: 'Test Toast' });
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    const toasts = document.querySelectorAll('[data-toast]');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toContain('Test Toast');
  });

  it('should remove toast from viewport when dismissed', () => {
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      ctx.addToast({ title: 'Test Toast' });
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    const closeButton = document.querySelector('[data-toast-close]') as HTMLButtonElement;
    closeButton.click();

    const toasts = document.querySelectorAll('[data-toast]');
    expect(toasts.length).toBe(0);
  });

  it('should handle multiple toasts with different variants', () => {
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      ctx.addToast({ title: 'Success', variant: 'success' });
      ctx.addToast({ title: 'Error', variant: 'error' });
      ctx.addToast({ title: 'Warning', variant: 'warning' });
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    const success = document.querySelector('[data-variant="success"]');
    const error = document.querySelector('[data-variant="error"]');
    const warning = document.querySelector('[data-variant="warning"]');

    expect(success).toBeTruthy();
    expect(error).toBeTruthy();
    expect(warning).toBeTruthy();
  });

  it('should auto-dismiss toasts in viewport', () => {
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      ctx.addToast({ title: 'Auto dismiss', duration: 1000 });
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    expect(document.querySelectorAll('[data-toast]').length).toBe(1);

    vi.advanceTimersByTime(1000);

    expect(document.querySelectorAll('[data-toast]').length).toBe(0);
  });

  it('should respect maxToasts limit in viewport', () => {
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      ctx.addToast({ title: 'Toast 1' });
      ctx.addToast({ title: 'Toast 2' });
      ctx.addToast({ title: 'Toast 3' });
      ctx.addToast({ title: 'Toast 4' });
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        maxToasts: 2,
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    const toasts = document.querySelectorAll('[data-toast]');
    expect(toasts.length).toBe(2);
  });

  it('should call action and dismiss toast', () => {
    const actionClick = vi.fn();
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      ctx.addToast({
        title: 'Action Toast',
        action: {
          label: 'Click me',
          onClick: actionClick,
        },
      });
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    const actionButton = document.querySelector('[data-toast-action]') as HTMLButtonElement;
    actionButton.click();

    expect(actionClick).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-toast]').length).toBe(0);
  });

  it('should handle rapid toast additions', () => {
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      for (let i = 0; i < 10; i++) {
        ctx.addToast({ title: `Toast ${i}` });
      }
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        maxToasts: 5,
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    const toasts = document.querySelectorAll('[data-toast]');
    expect(toasts.length).toBe(5);
  });

  it('should maintain toast order (newest last)', () => {
    const TestComponent = defineComponent(() => {
      const ctx = useContext(ToastContext);
      ctx.addToast({ title: 'First' });
      ctx.addToast({ title: 'Second' });
      ctx.addToast({ title: 'Third' });
      return ToastViewport({});
    });

    const { cleanup: dispose } = renderComponent(() =>
      ToastProvider({
        children: () => TestComponent({}),
      })
    );
    cleanup = dispose;

    const toasts = document.querySelectorAll('[data-toast-title]');
    expect(toasts[0].textContent).toBe('First');
    expect(toasts[1].textContent).toBe('Second');
    expect(toasts[2].textContent).toBe('Third');
  });
});
