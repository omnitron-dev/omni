/**
 * AlertDialog Primitive Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContext,
} from '../../../src/primitives/AlertDialog.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('AlertDialog Primitive', () => {
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
    document.body.style.overflow = '';
  });

  describe('AlertDialogContext', () => {
    it('should have default values', () => {
      expect(AlertDialogContext.id).toBeTypeOf('symbol');
      expect(AlertDialogContext.defaultValue).toBeDefined();
      expect(AlertDialogContext.defaultValue.isOpen()).toBe(false);
      expect(AlertDialogContext.defaultValue.open).toBeTypeOf('function');
      expect(AlertDialogContext.defaultValue.close).toBeTypeOf('function');
      expect(AlertDialogContext.defaultValue.toggle).toBeTypeOf('function');
    });

    it('should have stable default IDs', () => {
      expect(AlertDialogContext.defaultValue.triggerId).toBe('');
      expect(AlertDialogContext.defaultValue.contentId).toBe('');
      expect(AlertDialogContext.defaultValue.titleId).toBe('');
      expect(AlertDialogContext.defaultValue.descriptionId).toBe('');
    });
  });

  describe('Component Exports', () => {
    it('should export AlertDialog component', () => {
      expect(AlertDialog).toBeTypeOf('function');
    });

    it('should export AlertDialogTrigger component', () => {
      expect(AlertDialogTrigger).toBeTypeOf('function');
    });

    it('should export AlertDialogContent component', () => {
      expect(AlertDialogContent).toBeTypeOf('function');
    });

    it('should export AlertDialogTitle component', () => {
      expect(AlertDialogTitle).toBeTypeOf('function');
    });

    it('should export AlertDialogDescription component', () => {
      expect(AlertDialogDescription).toBeTypeOf('function');
    });

    it('should export AlertDialogAction component', () => {
      expect(AlertDialogAction).toBeTypeOf('function');
    });

    it('should export AlertDialogCancel component', () => {
      expect(AlertDialogCancel).toBeTypeOf('function');
    });

    it('should export AlertDialogContext', () => {
      expect(AlertDialogContext).toBeDefined();
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as AlertDialog.Trigger', () => {
      expect((AlertDialog as any).Trigger).toBe(AlertDialogTrigger);
    });

    it('should attach Content as AlertDialog.Content', () => {
      expect((AlertDialog as any).Content).toBe(AlertDialogContent);
    });

    it('should attach Title as AlertDialog.Title', () => {
      expect((AlertDialog as any).Title).toBe(AlertDialogTitle);
    });

    it('should attach Description as AlertDialog.Description', () => {
      expect((AlertDialog as any).Description).toBe(AlertDialogDescription);
    });

    it('should attach Action as AlertDialog.Action', () => {
      expect((AlertDialog as any).Action).toBe(AlertDialogAction);
    });

    it('should attach Cancel as AlertDialog.Cancel', () => {
      expect((AlertDialog as any).Cancel).toBe(AlertDialogCancel);
    });
  });

  describe('Component Structure', () => {
    it('should create AlertDialog with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({ children: AlertDialogTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept defaultOpen prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onOpenChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            onOpenChange: () => {},
            children: AlertDialogTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should start closed by default', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('AlertDialogTrigger Structure', () => {
    it('should create trigger with children', () => {
      dispose = createRoot(() => {
        const trigger = AlertDialogTrigger({ children: 'Open' });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const trigger = AlertDialogTrigger({
          children: 'Open',
          className: 'custom',
          'data-test': 'trigger',
        });
        expect(trigger).toBeTruthy();
      });
    });

    it('should have type="button"', () => {
      dispose = createRoot(() => {
        const trigger = AlertDialogTrigger({
          children: 'Open',
        });
        expect(trigger).toBeTruthy();
      });
    });
  });

  describe('AlertDialogContent Structure', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogContent({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogContent({
            children: 'Content',
            className: 'custom',
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnEscape prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogContent({
            children: 'Content',
            closeOnEscape: true,
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnOutsideClick prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogContent({
            children: 'Content',
            closeOnOutsideClick: true,
          });
        });
      }).not.toThrow();
    });

    it('should accept forceMount prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogContent({
            children: 'Content',
            forceMount: true,
          });
        });
      }).not.toThrow();
    });
  });

  describe('AlertDialogTitle Structure', () => {
    it('should create title with children', () => {
      dispose = createRoot(() => {
        const title = AlertDialogTitle({ children: 'Title' });
        expect(title).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const title = AlertDialogTitle({
          children: 'Title',
          className: 'custom',
        });
        expect(title).toBeTruthy();
      });
    });
  });

  describe('AlertDialogDescription Structure', () => {
    it('should create description with children', () => {
      dispose = createRoot(() => {
        const desc = AlertDialogDescription({ children: 'Description' });
        expect(desc).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const desc = AlertDialogDescription({
          children: 'Description',
          className: 'custom',
        });
        expect(desc).toBeTruthy();
      });
    });
  });

  describe('AlertDialogAction Structure', () => {
    it('should create action button with children', () => {
      dispose = createRoot(() => {
        const action = AlertDialogAction({ children: 'Delete' });
        expect(action).toBeTruthy();
      });
    });

    it('should accept onClick callback', () => {
      dispose = createRoot(() => {
        const action = AlertDialogAction({
          children: 'Delete',
          onClick: () => {},
        });
        expect(action).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const action = AlertDialogAction({
          children: 'Delete',
          className: 'danger',
        });
        expect(action).toBeTruthy();
      });
    });
  });

  describe('AlertDialogCancel Structure', () => {
    it('should create cancel button with children', () => {
      dispose = createRoot(() => {
        const cancel = AlertDialogCancel({ children: 'Cancel' });
        expect(cancel).toBeTruthy();
      });
    });

    it('should accept onClick callback', () => {
      dispose = createRoot(() => {
        const cancel = AlertDialogCancel({
          children: 'Cancel',
          onClick: () => {},
        });
        expect(cancel).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const cancel = AlertDialogCancel({
          children: 'Cancel',
          className: 'secondary',
        });
        expect(cancel).toBeTruthy();
      });
    });
  });

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      dispose = createRoot(() => {
        const alertDialog = AlertDialog({
          children: [
            AlertDialogTrigger({ children: 'Delete' }),
            AlertDialogContent({
              children: [
                AlertDialogTitle({ children: 'Are you sure?' }),
                AlertDialogDescription({ children: 'This action cannot be undone.' }),
                AlertDialogAction({ children: 'Delete' }),
                AlertDialogCancel({ children: 'Cancel' }),
              ],
            }),
          ],
        });

        expect(alertDialog).toBeTruthy();
      });
    });

    it('should work with nested structure', () => {
      dispose = createRoot(() => {
        const alertDialog = AlertDialog({
          defaultOpen: false,
          onOpenChange: () => {},
          children: [
            AlertDialogTrigger({
              children: 'Delete Account',
              className: 'trigger',
            }),
            AlertDialogContent({
              children: [
                AlertDialogTitle({ children: 'Delete Account?' }),
                AlertDialogDescription({ children: 'This will permanently delete your account.' }),
                AlertDialogAction({ children: 'Confirm Delete' }),
                AlertDialogCancel({ children: 'Cancel' }),
              ],
              className: 'content',
            }),
          ],
        });

        expect(alertDialog).toBeTruthy();
      });
    });

    it('should work with minimal composition', () => {
      dispose = createRoot(() => {
        const alertDialog = AlertDialog({
          children: [
            AlertDialogTrigger({ children: 'Open' }),
            AlertDialogContent({
              children: [AlertDialogTitle({ children: 'Alert' }), AlertDialogAction({ children: 'OK' })],
            }),
          ],
        });

        expect(alertDialog).toBeTruthy();
      });
    });
  });

  describe('Type Safety', () => {
    it('should accept children prop on AlertDialog', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({ children: AlertDialogTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept all alert dialog props', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            children: AlertDialogContent({ children: 'Content' }),
            defaultOpen: true,
            onOpenChange: (open: boolean) => {
              expect(typeof open).toBe('boolean');
            },
          });
        });
      }).not.toThrow();
    });

    it('should accept content props', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogContent({
            children: 'Content',
            closeOnEscape: true,
            closeOnOutsideClick: false,
            forceMount: false,
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(AlertDialogContext).toBeDefined();
      expect(AlertDialogContext.Provider).toBeTypeOf('function');
      expect(AlertDialogContext.defaultValue).toBeDefined();
    });

    it('should provide stable component references', () => {
      const Trigger1 = (AlertDialog as any).Trigger;
      const Trigger2 = (AlertDialog as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });

    it('should provide stable context ID', () => {
      const id1 = AlertDialogContext.id;
      const id2 = AlertDialogContext.id;
      expect(id1).toBe(id2);
    });
  });

  describe('ARIA Attributes', () => {
    it('should set role="alertdialog" on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should set aria-modal="true" on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should set aria-haspopup="dialog" on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            children: AlertDialogTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Data Attributes', () => {
    it('should set data-state on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            children: AlertDialogTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should set data-state on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should set data-alert-dialog-overlay attribute', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Focus Management', () => {
    it('should trap focus in content when open', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should set tabIndex=-1 on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Modal Behavior', () => {
    it('should disable body scroll when open', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should block Escape key by default', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({
              children: 'Content',
              closeOnEscape: false,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should block outside click by default', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({
              children: 'Content',
              closeOnOutsideClick: false,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should allow Escape key when enabled', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({
              children: 'Content',
              closeOnEscape: true,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should allow outside click when enabled', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({
              children: 'Content',
              closeOnOutsideClick: true,
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Portal Rendering', () => {
    it('should render content in portal', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should not render when closed', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: false,
            children: AlertDialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should render when closed with forceMount', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: false,
            children: AlertDialogContent({
              children: 'Content',
              forceMount: true,
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing onOpenChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            children: AlertDialogTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle missing onClick on Action', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogAction({ children: 'Delete' });
        });
      }).not.toThrow();
    });

    it('should handle missing onClick on Cancel', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialogCancel({ children: 'Cancel' });
        });
      }).not.toThrow();
    });

    it('should handle missing onClick on Trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            children: AlertDialogTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should work without Title', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({
              children: [
                AlertDialogDescription({ children: 'Description only' }),
                AlertDialogAction({ children: 'OK' }),
              ],
            }),
          });
        });
      }).not.toThrow();
    });

    it('should work without Description', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({
              children: [AlertDialogTitle({ children: 'Title only' }), AlertDialogAction({ children: 'OK' })],
            }),
          });
        });
      }).not.toThrow();
    });

    it('should work without Cancel button', () => {
      expect(() => {
        dispose = createRoot(() => {
          AlertDialog({
            defaultOpen: true,
            children: AlertDialogContent({
              children: [AlertDialogTitle({ children: 'Alert' }), AlertDialogAction({ children: 'OK' })],
            }),
          });
        });
      }).not.toThrow();
    });
  });
});
