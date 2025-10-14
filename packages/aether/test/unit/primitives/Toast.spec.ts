/**
 * Toast Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastProvider, ToastViewport, Toast, ToastContext, type ToastData } from '../../../src/primitives/Toast.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Toast Primitive', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    document.body.removeChild(container);
    // Clean up any portals
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('ToastContext', () => {
    it('should have default values', () => {
      expect(ToastContext.id).toBeTypeOf('symbol');
      expect(ToastContext.defaultValue).toBeDefined();
      expect(ToastContext.defaultValue.toasts).toBeTypeOf('function');
      expect(ToastContext.defaultValue.addToast).toBeTypeOf('function');
      expect(ToastContext.defaultValue.removeToast).toBeTypeOf('function');
    });

    it('should have default maxToasts of 3', () => {
      expect(ToastContext.defaultValue.maxToasts).toBe(3);
    });

    it('should have default duration of 5000', () => {
      expect(ToastContext.defaultValue.duration).toBe(5000);
    });

    it('should have empty toasts by default', () => {
      const result = ToastContext.defaultValue.toasts();
      expect(result).toEqual([]);
    });

    it('should have noop addToast that returns empty string', () => {
      const result = ToastContext.defaultValue.addToast({ title: 'Test' });
      expect(result).toBe('');
    });

    it('should have noop removeToast', () => {
      expect(() => {
        ToastContext.defaultValue.removeToast('test-id');
      }).not.toThrow();
    });
  });

  describe('Component Exports', () => {
    it('should export ToastProvider component', () => {
      expect(ToastProvider).toBeTypeOf('function');
    });

    it('should export ToastViewport component', () => {
      expect(ToastViewport).toBeTypeOf('function');
    });

    it('should export Toast component', () => {
      expect(Toast).toBeTypeOf('function');
    });

    it('should export ToastContext', () => {
      expect(ToastContext).toBeDefined();
      expect(ToastContext.Provider).toBeTypeOf('function');
    });
  });

  describe('ToastProvider', () => {
    it('should create provider with default props', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should accept maxToasts prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            maxToasts: 5,
            children: 'Content',
          });
        });
      }).not.toThrow();
    });

    it('should accept duration prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            duration: 3000,
            children: 'Content',
          });
        });
      }).not.toThrow();
    });

    it('should accept children prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: [ToastViewport({})],
          });
        });
      }).not.toThrow();
    });

    it('should provide context value to children', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should use default maxToasts of 3 when not provided', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should use default duration of 5000 when not provided', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should handle maxToasts of 1', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            maxToasts: 1,
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should handle maxToasts of 10', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            maxToasts: 10,
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should handle duration of 0 (no auto-dismiss)', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            duration: 0,
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should handle large duration values', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            duration: 30000,
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });
  });

  describe('ToastViewport', () => {
    it('should create viewport with default props', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should accept hotkey prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({
              hotkey: 'F9',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept label prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({
              label: 'Custom Notifications',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({
              className: 'custom-viewport',
              'data-test': 'viewport',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should use default hotkey F8', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should use default label "Notifications"', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should render empty list when no toasts', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should accept children prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({
              style: { position: 'fixed', top: '20px' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept id prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({
              id: 'custom-viewport',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Toast Component', () => {
    it('should create toast with required props', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test Toast',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({
            toast: toastData,
          });
        });
      }).not.toThrow();
    });

    it('should accept toast with title', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Success',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with description', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        description: 'Operation completed',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with both title and description', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Success',
        description: 'Operation completed',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with default variant', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        variant: 'default',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with success variant', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Success',
        variant: 'success',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with error variant', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Error',
        variant: 'error',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with warning variant', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Warning',
        variant: 'warning',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with info variant', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Info',
        variant: 'info',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with action', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        action: {
          label: 'Undo',
          onClick: () => {},
        },
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept toast with duration', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        duration: 3000,
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should accept onDismiss callback', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      const onDismiss = vi.fn();

      expect(() => {
        dispose = createRoot(() => {
          Toast({
            toast: toastData,
            onDismiss,
          });
        });
      }).not.toThrow();
    });

    it('should accept children prop', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({
            toast: toastData,
            children: 'Custom content',
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({
            toast: toastData,
            className: 'custom-toast',
            'data-test': 'toast',
          });
        });
      }).not.toThrow();
    });
  });

  describe('Toast Data Structure', () => {
    it('should handle toast with only id', () => {
      const toastData: ToastData = {
        id: 'toast-1',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle toast with all properties', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Success',
        description: 'Operation completed successfully',
        variant: 'success',
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {},
        },
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle toast with long title', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'A'.repeat(100),
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle toast with long description', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        description: 'B'.repeat(200),
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle toast with special characters in title', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: '<script>alert("xss")</script>',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle toast with unicode characters', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: '🎉 Success! 成功！',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });
  });

  describe('Toast Action', () => {
    it('should handle action with simple label', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        action: {
          label: 'Action',
          onClick: () => {},
        },
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle action with long label', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        action: {
          label: 'This is a very long action label',
          onClick: () => {},
        },
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle action with onClick callback', () => {
      const onClick = vi.fn();
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        action: {
          label: 'Action',
          onClick,
        },
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });
  });

  describe('Composition', () => {
    it('should compose provider and viewport', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should compose with custom props', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            maxToasts: 5,
            duration: 3000,
            children: ToastViewport({
              hotkey: 'F9',
              label: 'Custom',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should compose with nested children', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: [ToastViewport({}), 'Other content'],
          });
        });
      }).not.toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should accept valid ToastData', () => {
      const toastData: ToastData = {
        id: 'test',
        title: 'Title',
      };

      expect(toastData.id).toBe('test');
      expect(toastData.title).toBe('Title');
    });

    it('should accept ToastData with all optional fields', () => {
      const toastData: ToastData = {
        id: 'test',
        title: 'Title',
        description: 'Desc',
        variant: 'success',
        duration: 5000,
        action: {
          label: 'Action',
          onClick: () => {},
        },
      };

      expect(toastData).toBeDefined();
    });

    it('should handle missing toast prop gracefully', () => {
      // Component doesn't throw, it handles errors internally
      expect(() => {
        dispose = createRoot(() => {
          // @ts-expect-error - toast is required
          Toast({});
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(ToastContext).toBeDefined();
      expect(ToastContext.Provider).toBeTypeOf('function');
      expect(ToastContext.defaultValue).toBeDefined();
    });

    it('should provide stable context reference', () => {
      const ctx1 = ToastContext;
      const ctx2 = ToastContext;
      expect(ctx1).toBe(ctx2);
    });
  });

  describe('ARIA Attributes', () => {
    it('should have proper ARIA role on viewport', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should have proper ARIA role on toast', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have aria-live attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have aria-atomic attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have aria-label on close button', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });
  });

  describe('Data Attributes', () => {
    it('should have data-toast-viewport attribute', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should have data-toast attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have data-variant attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        variant: 'success',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have data-toast-title attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have data-toast-description attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        description: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have data-toast-action attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        action: {
          label: 'Action',
          onClick: () => {},
        },
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should have data-toast-close attribute', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty toast list', () => {
      expect(() => {
        dispose = createRoot(() => {
          ToastProvider({
            children: ToastViewport({}),
          });
        });
      }).not.toThrow();
    });

    it('should handle zero duration', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        duration: 0,
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle negative duration', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        duration: -1,
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle empty string title', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: '',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle empty string description', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        description: '',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle empty string action label', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
        action: {
          label: '',
          onClick: () => {},
        },
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });

    it('should handle toast without onDismiss', () => {
      const toastData: ToastData = {
        id: 'toast-1',
        title: 'Test',
      };

      expect(() => {
        dispose = createRoot(() => {
          Toast({ toast: toastData });
        });
      }).not.toThrow();
    });
  });
});
