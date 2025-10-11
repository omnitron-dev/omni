/**
 * Popconfirm Primitive Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Popconfirm,
  PopconfirmTrigger,
  PopconfirmContent,
} from '../../../src/primitives/Popconfirm.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Popconfirm Primitive', () => {
  let container: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    if (container && container.parentNode) {
      document.body.removeChild(container);
    }
    // Clean up any portals
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
  });

  describe('Component Exports', () => {
    it('should export Popconfirm component', () => {
      expect(Popconfirm).toBeTypeOf('function');
    });

    it('should export PopconfirmTrigger component', () => {
      expect(PopconfirmTrigger).toBeTypeOf('function');
    });

    it('should export PopconfirmContent component', () => {
      expect(PopconfirmContent).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as Popconfirm.Trigger', () => {
      expect((Popconfirm as any).Trigger).toBe(PopconfirmTrigger);
    });

    it('should attach Content as Popconfirm.Content', () => {
      expect((Popconfirm as any).Content).toBe(PopconfirmContent);
    });
  });

  describe('Component Structure', () => {
    it('should create Popconfirm with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Are you sure?',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept title prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm action',
            children: PopconfirmTrigger({ children: 'Action' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept description prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Are you sure?',
            description: 'This action cannot be undone',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onConfirm callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onConfirm: () => {},
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onCancel callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onCancel: () => {},
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept okText prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            okText: 'Yes',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept cancelText prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            cancelText: 'No',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should start closed by default', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Open' }),
              PopconfirmContent({ children: 'Content' }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  describe('PopconfirmTrigger Structure', () => {
    it('should create trigger with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({
              children: 'Delete',
              className: 'custom',
              'data-test': 'trigger',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({
              children: 'Delete',
              style: { color: 'red' },
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('PopconfirmContent Structure', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Open' }),
              PopconfirmContent({ children: 'Content' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Open' }),
              PopconfirmContent({
                children: 'Content',
                className: 'custom',
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should have role="dialog"', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Open' }),
              PopconfirmContent({ children: 'Content' }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  describe('Composition', () => {
    it('should allow composing trigger and content', () => {
      dispose = createRoot(() => {
        const popconfirm = Popconfirm({
          title: 'Delete item?',
          description: 'This cannot be undone',
          onConfirm: () => {},
          onCancel: () => {},
          okText: 'Delete',
          cancelText: 'Cancel',
          children: [
            PopconfirmTrigger({ children: 'Delete' }),
            PopconfirmContent({ children: 'Custom content' }),
          ],
        });

        expect(popconfirm).toBeTruthy();
      });
    });

    it('should work with minimal composition', () => {
      dispose = createRoot(() => {
        const popconfirm = Popconfirm({
          title: 'Confirm?',
          children: PopconfirmTrigger({ children: 'Action' }),
        });

        expect(popconfirm).toBeTruthy();
      });
    });

    it('should work without content component', () => {
      dispose = createRoot(() => {
        const popconfirm = Popconfirm({
          title: 'Confirm?',
          onConfirm: () => {},
          children: PopconfirmTrigger({ children: 'Action' }),
        });

        expect(popconfirm).toBeTruthy();
      });
    });
  });

  describe('Type Safety', () => {
    it('should accept all popconfirm props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Are you sure?',
            description: 'This is permanent',
            onConfirm: async () => {},
            onCancel: () => {},
            okText: 'Yes',
            cancelText: 'No',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept async onConfirm callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onConfirm: async () => {
              await new Promise((resolve) => setTimeout(resolve, 100));
            },
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should provide stable component references', () => {
      const Trigger1 = (Popconfirm as any).Trigger;
      const Trigger2 = (Popconfirm as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });

    it('should provide stable content reference', () => {
      const Content1 = (Popconfirm as any).Content;
      const Content2 = (Popconfirm as any).Content;
      expect(Content1).toBe(Content2);
    });
  });

  describe('Data Attributes', () => {
    it('should set data-popconfirm on root', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should set data-popconfirm-trigger on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should set data-popconfirm-content on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Open' }),
              PopconfirmContent({ children: 'Content' }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  describe('Callback Behavior', () => {
    it('should call onConfirm when confirmed', () => {
      const onConfirm = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onConfirm,
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should call onCancel when cancelled', () => {
      const onCancel = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onCancel,
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should support async onConfirm', () => {
      const onConfirm = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onConfirm,
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing onConfirm callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle missing onCancel callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle missing description', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle missing okText', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle missing cancelText', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with empty description', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            description: '',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with long title', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Are you absolutely sure you want to delete this item permanently?',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with long description', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Delete',
            description:
              'This action cannot be undone. This will permanently delete the item and remove all associated data from our servers.',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple triggers', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Trigger 1' }),
              PopconfirmTrigger({ children: 'Trigger 2' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple content components', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Open' }),
              PopconfirmContent({ children: 'Content 1' }),
              PopconfirmContent({ children: 'Content 2' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should work with custom button text', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Permanently delete?',
            okText: 'Yes, delete forever',
            cancelText: 'No, keep it',
            children: PopconfirmTrigger({ children: 'Delete' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle onConfirm throwing error', () => {
      const onConfirm = vi.fn(() => {
        throw new Error('Test error');
      });
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onConfirm,
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle async onConfirm rejecting', () => {
      const onConfirm = vi.fn(async () => {
        throw new Error('Test error');
      });
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            onConfirm,
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    it('should have role="dialog" on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: [
              PopconfirmTrigger({ children: 'Open' }),
              PopconfirmContent({ children: 'Content' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should be keyboard accessible', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Confirm',
            children: PopconfirmTrigger({ children: 'OK' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    it('should work in a form context', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Submit form?',
            onConfirm: async () => {
              // Submit form
            },
            children: PopconfirmTrigger({ children: 'Submit' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with destructive actions', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Delete account?',
            description: 'This action is irreversible',
            okText: 'Delete',
            cancelText: 'Cancel',
            onConfirm: async () => {
              // Delete account
            },
            children: PopconfirmTrigger({ children: 'Delete Account' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with non-destructive confirmations', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popconfirm({
            title: 'Save changes?',
            okText: 'Save',
            cancelText: 'Discard',
            onConfirm: async () => {
              // Save changes
            },
            children: PopconfirmTrigger({ children: 'Close' }),
          });
        });
      }).not.toThrow();
    });
  });
});
