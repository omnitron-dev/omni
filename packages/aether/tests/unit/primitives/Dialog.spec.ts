/**
 * Dialog Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogContext,
} from '../../../src/primitives/Dialog.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Dialog Primitive', () => {
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
    document.body.removeChild(container);
    // Clean up any portals
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
  });

  describe('DialogContext', () => {
    it('should have default values', () => {
      expect(DialogContext.id).toBeTypeOf('symbol');
      expect(DialogContext.defaultValue).toBeDefined();
      expect(DialogContext.defaultValue.isOpen()).toBe(false);
      expect(DialogContext.defaultValue.open).toBeTypeOf('function');
      expect(DialogContext.defaultValue.close).toBeTypeOf('function');
      expect(DialogContext.defaultValue.toggle).toBeTypeOf('function');
    });

    it('should have stable default IDs', () => {
      expect(DialogContext.defaultValue.triggerId).toBe('');
      expect(DialogContext.defaultValue.contentId).toBe('');
      expect(DialogContext.defaultValue.titleId).toBe('');
      expect(DialogContext.defaultValue.descriptionId).toBe('');
    });
  });

  describe('Component Exports', () => {
    it('should export Dialog component', () => {
      expect(Dialog).toBeTypeOf('function');
    });

    it('should export DialogTrigger component', () => {
      expect(DialogTrigger).toBeTypeOf('function');
    });

    it('should export DialogContent component', () => {
      expect(DialogContent).toBeTypeOf('function');
    });

    it('should export DialogTitle component', () => {
      expect(DialogTitle).toBeTypeOf('function');
    });

    it('should export DialogDescription component', () => {
      expect(DialogDescription).toBeTypeOf('function');
    });

    it('should export DialogClose component', () => {
      expect(DialogClose).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as Dialog.Trigger', () => {
      expect((Dialog as any).Trigger).toBe(DialogTrigger);
    });

    it('should attach Content as Dialog.Content', () => {
      expect((Dialog as any).Content).toBe(DialogContent);
    });

    it('should attach Title as Dialog.Title', () => {
      expect((Dialog as any).Title).toBe(DialogTitle);
    });

    it('should attach Description as Dialog.Description', () => {
      expect((Dialog as any).Description).toBe(DialogDescription);
    });

    it('should attach Close as Dialog.Close', () => {
      expect((Dialog as any).Close).toBe(DialogClose);
    });
  });

  describe('Component Structure', () => {
    it('should create Dialog with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Dialog({ children: DialogTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept defaultOpen prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Dialog({
            defaultOpen: true,
            children: DialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onOpenChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Dialog({
            onOpenChange: () => {},
            children: DialogTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept modal prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Dialog({
            modal: false,
            children: DialogContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('DialogTrigger Structure', () => {
    it('should create trigger with children', () => {
      dispose = createRoot(() => {
        const trigger = DialogTrigger({ children: 'Open' });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const trigger = DialogTrigger({
          children: 'Open',
          className: 'custom',
          'data-test': 'trigger',
        });
        expect(trigger).toBeTruthy();
      });
    });
  });

  describe('DialogContent Structure', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          DialogContent({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          DialogContent({
            children: 'Content',
            className: 'custom',
          });
        });
      }).not.toThrow();
    });
  });

  describe('DialogTitle Structure', () => {
    it('should create title with children', () => {
      dispose = createRoot(() => {
        const title = DialogTitle({ children: 'Title' });
        expect(title).toBeTruthy();
      });
    });
  });

  describe('DialogDescription Structure', () => {
    it('should create description with children', () => {
      dispose = createRoot(() => {
        const desc = DialogDescription({ children: 'Description' });
        expect(desc).toBeTruthy();
      });
    });
  });

  describe('DialogClose Structure', () => {
    it('should create close button with children', () => {
      dispose = createRoot(() => {
        const close = DialogClose({ children: 'Close' });
        expect(close).toBeTruthy();
      });
    });
  });

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      dispose = createRoot(() => {
        const dialog = Dialog({
          children: [
            DialogTrigger({ children: 'Open' }),
            DialogContent({
              children: [
                DialogTitle({ children: 'Title' }),
                DialogDescription({ children: 'Description' }),
                DialogClose({ children: 'Close' }),
              ],
            }),
          ],
        });

        expect(dialog).toBeTruthy();
      });
    });

    it('should work with nested structure', () => {
      dispose = createRoot(() => {
        const dialog = Dialog({
          defaultOpen: false,
          onOpenChange: () => {},
          children: [
            DialogTrigger({
              children: 'Open Dialog',
              className: 'trigger',
            }),
            DialogContent({
              children: [
                DialogTitle({ children: 'My Dialog' }),
                DialogDescription({ children: 'This is a dialog' }),
                DialogClose({ children: 'Close' }),
              ],
              className: 'content',
            }),
          ],
        });

        expect(dialog).toBeTruthy();
      });
    });
  });

  describe('Type Safety', () => {
    it('should accept children prop on Dialog', () => {
      expect(() => {
        dispose = createRoot(() => {
          Dialog({ children: DialogTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept all dialog props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Dialog({
            children: DialogContent({ children: 'Content' }),
            defaultOpen: true,
            modal: true,
            onOpenChange: (open: boolean) => {
              expect(typeof open).toBe('boolean');
            },
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(DialogContext).toBeDefined();
      expect(DialogContext.Provider).toBeTypeOf('function');
      expect(DialogContext.defaultValue).toBeDefined();
    });

    it('should provide stable component references', () => {
      const Trigger1 = (Dialog as any).Trigger;
      const Trigger2 = (Dialog as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });
  });
});
