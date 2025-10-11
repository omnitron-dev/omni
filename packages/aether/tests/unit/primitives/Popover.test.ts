/**
 * Popover Primitive Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverArrow,
  PopoverAnchor,
  PopoverClose,
  PopoverContext,
} from '../../../src/primitives/Popover.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Popover Primitive', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
    document.body.innerHTML = '';
    // Clean up any portals
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
  });

  describe('PopoverContext', () => {
    it('should have default values', () => {
      expect(PopoverContext.id).toBeTypeOf('symbol');
      expect(PopoverContext.defaultValue).toBeDefined();
      expect(PopoverContext.defaultValue.isOpen()).toBe(false);
      expect(PopoverContext.defaultValue.open).toBeTypeOf('function');
      expect(PopoverContext.defaultValue.close).toBeTypeOf('function');
      expect(PopoverContext.defaultValue.toggle).toBeTypeOf('function');
    });

    it('should have stable default IDs', () => {
      expect(PopoverContext.defaultValue.triggerId).toBe('');
      expect(PopoverContext.defaultValue.contentId).toBe('');
    });
  });

  describe('Component Exports', () => {
    it('should export Popover component', () => {
      expect(Popover).toBeTypeOf('function');
    });

    it('should export PopoverTrigger component', () => {
      expect(PopoverTrigger).toBeTypeOf('function');
    });

    it('should export PopoverContent component', () => {
      expect(PopoverContent).toBeTypeOf('function');
    });

    it('should export PopoverArrow component', () => {
      expect(PopoverArrow).toBeTypeOf('function');
    });

    it('should export PopoverClose component', () => {
      expect(PopoverClose).toBeTypeOf('function');
    });

    it('should export PopoverAnchor component', () => {
      expect(PopoverAnchor).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as Popover.Trigger', () => {
      expect((Popover as any).Trigger).toBe(PopoverTrigger);
    });

    it('should attach Content as Popover.Content', () => {
      expect((Popover as any).Content).toBe(PopoverContent);
    });

    it('should attach Arrow as Popover.Arrow', () => {
      expect((Popover as any).Arrow).toBe(PopoverArrow);
    });

    it('should attach Close as Popover.Close', () => {
      expect((Popover as any).Close).toBe(PopoverClose);
    });

    it('should attach Anchor as Popover.Anchor', () => {
      expect((Popover as any).Anchor).toBe(PopoverAnchor);
    });
  });

  describe('Component Structure', () => {
    it('should create Popover with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popover({ children: PopoverTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept defaultOpen prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popover({
            defaultOpen: true,
            children: PopoverContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onOpenChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popover({
            onOpenChange: () => {},
            children: PopoverTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept modal prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popover({
            modal: false,
            children: PopoverContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('PopoverTrigger Structure', () => {
    it('should create trigger with children', () => {
      dispose = createRoot(() => {
        const trigger = PopoverTrigger({ children: 'Open' });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const trigger = PopoverTrigger({
          children: 'Open',
          className: 'custom',
          'data-test': 'trigger',
        });
        expect(trigger).toBeTruthy();
      });
    });
  });

  describe('PopoverContent Structure', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          PopoverContent({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          PopoverContent({
            children: 'Content',
            className: 'custom',
          });
        });
      }).not.toThrow();
    });

    it('should accept positioning props', () => {
      expect(() => {
        dispose = createRoot(() => {
          PopoverContent({
            children: 'Content',
            side: 'top' as const,
            align: 'start' as const,
            sideOffset: 10,
            alignOffset: 5,
            avoidCollisions: true,
            collisionPadding: 20,
          });
        });
      }).not.toThrow();
    });
  });

  describe('PopoverArrow Structure', () => {
    it('should create arrow with default props', () => {
      expect(() => {
        dispose = createRoot(() => {
          PopoverArrow({});
        });
      }).not.toThrow();
    });

    it('should accept custom width and height', () => {
      expect(() => {
        dispose = createRoot(() => {
          PopoverArrow({
            width: 20,
            height: 10,
          });
        });
      }).not.toThrow();
    });
  });

  describe('PopoverAnchor Structure', () => {
    it('should create anchor with children', () => {
      dispose = createRoot(() => {
        const anchor = PopoverAnchor({ children: 'Anchor' });
        expect(anchor).toBeTruthy();
      });
    });

    it('should accept children prop', () => {
      dispose = createRoot(() => {
        const anchor = PopoverAnchor({
          children: 'Anchor element',
        });
        expect(anchor).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const anchor = PopoverAnchor({
          children: 'Anchor',
          className: 'custom-anchor',
          'data-test': 'anchor',
        });
        expect(anchor).toBeTruthy();
      });
    });

    it('should work without children', () => {
      dispose = createRoot(() => {
        const anchor = PopoverAnchor({});
        expect(anchor).toBeTruthy();
      });
    });
  });

  describe('PopoverClose Structure', () => {
    it('should create close button with children', () => {
      dispose = createRoot(() => {
        const close = PopoverClose({ children: 'Close' });
        expect(close).toBeTruthy();
      });
    });
  });

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      dispose = createRoot(() => {
        const popover = Popover({
          children: [
            PopoverTrigger({ children: 'Open' }),
            PopoverContent({
              children: [
                'Popover content',
                PopoverArrow({}),
                PopoverClose({ children: 'Close' }),
              ],
            }),
          ],
        });

        expect(popover).toBeTruthy();
      });
    });

    it('should allow composing with Anchor component', () => {
      dispose = createRoot(() => {
        const popover = Popover({
          children: [
            PopoverTrigger({ children: 'Open' }),
            PopoverAnchor({
              children: 'Position relative to this',
              className: 'anchor',
            }),
            PopoverContent({
              children: [
                'Popover content',
                PopoverArrow({}),
                PopoverClose({ children: 'Close' }),
              ],
            }),
          ],
        });

        expect(popover).toBeTruthy();
      });
    });

    it('should work with nested structure', () => {
      dispose = createRoot(() => {
        const popover = Popover({
          defaultOpen: false,
          onOpenChange: () => {},
          children: [
            PopoverTrigger({
              children: 'Open Popover',
              className: 'trigger',
            }),
            PopoverContent({
              side: 'bottom' as const,
              align: 'center' as const,
              children: [
                'This is popover content',
                PopoverArrow({ width: 12, height: 6 }),
                PopoverClose({ children: 'Close' }),
              ],
              className: 'content',
            }),
          ],
        });

        expect(popover).toBeTruthy();
      });
    });
  });

  describe('Type Safety', () => {
    it('should accept children prop on Popover', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popover({ children: PopoverTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept all popover props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Popover({
            children: PopoverContent({ children: 'Content' }),
            defaultOpen: true,
            modal: false,
            onOpenChange: (open: boolean) => {
              expect(typeof open).toBe('boolean');
            },
          });
        });
      }).not.toThrow();
    });

    it('should accept positioning props on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          PopoverContent({
            children: 'Content',
            side: 'top' as const,
            align: 'start' as const,
            sideOffset: 10,
            alignOffset: 5,
            avoidCollisions: true,
            collisionPadding: 20,
            onEscapeKeyDown: () => {},
            onPointerDownOutside: () => {},
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(PopoverContext).toBeDefined();
      expect(PopoverContext.Provider).toBeTypeOf('function');
      expect(PopoverContext.defaultValue).toBeDefined();
    });

    it('should provide stable component references', () => {
      const Trigger1 = (Popover as any).Trigger;
      const Trigger2 = (Popover as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });
  });
});
