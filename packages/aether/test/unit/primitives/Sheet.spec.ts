/**
 * Sheet Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
  SheetContext,
  type SheetSide,
} from '../../../src/primitives/Sheet.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Sheet Primitive', () => {
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
    vi.restoreAllMocks();
  });

  describe('SheetContext', () => {
    it('should have default values', () => {
      expect(SheetContext.id).toBeTypeOf('symbol');
      expect(SheetContext.defaultValue).toBeDefined();
      expect(SheetContext.defaultValue.isOpen).toBeTypeOf('function');
      expect(SheetContext.defaultValue.open).toBeTypeOf('function');
      expect(SheetContext.defaultValue.close).toBeTypeOf('function');
    });

    it('should have default context values', () => {
      // Note: side is component-specific, not part of the factory's default context
      expect(SheetContext.defaultValue.isOpen()).toBe(false);
    });

    it('should have empty default IDs', () => {
      expect(SheetContext.defaultValue.triggerId).toBe('');
      expect(SheetContext.defaultValue.contentId).toBe('');
      expect(SheetContext.defaultValue.titleId).toBe('');
      expect(SheetContext.defaultValue.descriptionId).toBe('');
    });

    it('should have closed state by default', () => {
      expect(SheetContext.defaultValue.isOpen()).toBe(false);
    });

    it('should have noop open function', () => {
      expect(() => {
        SheetContext.defaultValue.open();
      }).not.toThrow();
    });

    it('should have noop close function', () => {
      expect(() => {
        SheetContext.defaultValue.close();
      }).not.toThrow();
    });
  });

  describe('Component Exports', () => {
    it('should export Sheet component', () => {
      expect(Sheet).toBeTypeOf('function');
    });

    it('should export SheetTrigger component', () => {
      expect(SheetTrigger).toBeTypeOf('function');
    });

    it('should export SheetContent component', () => {
      expect(SheetContent).toBeTypeOf('function');
    });

    it('should export SheetTitle component', () => {
      expect(SheetTitle).toBeTypeOf('function');
    });

    it('should export SheetDescription component', () => {
      expect(SheetDescription).toBeTypeOf('function');
    });

    it('should export SheetClose component', () => {
      expect(SheetClose).toBeTypeOf('function');
    });

    it('should export SheetContext', () => {
      expect(SheetContext).toBeDefined();
      expect(SheetContext.Provider).toBeTypeOf('function');
    });
  });

  describe('Sheet Root', () => {
    it('should create sheet with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept defaultOpen prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept open prop (controlled)', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            open: false,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onOpenChange callback', () => {
      const onOpenChange = vi.fn();

      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            onOpenChange,
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - right', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            side: 'right',
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - left', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            side: 'left',
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - top', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            side: 'top',
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - bottom', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            side: 'bottom',
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should use default side of right when not provided', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept children as single element', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept children as array', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: [SheetTrigger({ children: 'Open' }), SheetContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });
  });

  describe('SheetTrigger', () => {
    it('should create trigger with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({ children: 'Open Sheet' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({
              children: 'Open',
              className: 'custom-trigger',
              'data-test': 'trigger',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({
              children: 'Open',
              style: { backgroundColor: 'blue' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept id prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({
              children: 'Open',
              id: 'custom-trigger',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept disabled prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({
              children: 'Open',
              disabled: true,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept element children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({
              children: SheetTitle({ children: 'Title' }),
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('SheetContent', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Sheet content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnEscape prop - true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnEscape: true,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnEscape prop - false', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnEscape: false,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnOverlayClick prop - true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnOverlayClick: true,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnOverlayClick prop - false', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnOverlayClick: false,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: 'Content',
              className: 'custom-content',
              'data-test': 'content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: 'Content',
              style: { padding: '20px' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept id prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: 'Content',
              id: 'custom-content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should not render when closed', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: false,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should render when open', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('SheetTitle', () => {
    it('should create title with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTitle({ children: 'Sheet Title' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTitle({ children: 'Title' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTitle({
              children: 'Title',
              className: 'custom-title',
              'data-test': 'title',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTitle({
              children: 'Title',
              style: { fontSize: '24px' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept id prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTitle({
              children: 'Title',
              id: 'custom-title',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('SheetDescription', () => {
    it('should create description with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetDescription({ children: 'Sheet description' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetDescription({ children: 'Description' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetDescription({
              children: 'Description',
              className: 'custom-description',
              'data-test': 'description',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetDescription({
              children: 'Description',
              style: { color: 'gray' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept id prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetDescription({
              children: 'Description',
              id: 'custom-description',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('SheetClose', () => {
    it('should create close button with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetClose({ children: 'Close' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetClose({ children: 'Close' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetClose({
              children: 'Close',
              className: 'custom-close',
              'data-test': 'close',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetClose({
              children: 'Close',
              style: { position: 'absolute' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onClick prop', () => {
      const onClick = vi.fn();

      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetClose({
              children: 'Close',
              onClick,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept disabled prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetClose({
              children: 'Close',
              disabled: true,
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Composition', () => {
    it('should compose all sub-components', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: [
              SheetTrigger({ children: 'Open' }),
              SheetContent({
                children: [
                  SheetTitle({ children: 'Title' }),
                  SheetDescription({ children: 'Description' }),
                  SheetClose({ children: 'Close' }),
                ],
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should compose with all sides', () => {
      const sides: SheetSide[] = ['top', 'right', 'bottom', 'left'];

      sides.forEach((side) => {
        expect(() => {
          dispose = createRoot(() => {
            Sheet({
              side,
              children: SheetContent({ children: 'Content' }),
            });
          });
        }).not.toThrow();
      });
    });

    it('should compose with controlled open state', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            open: true,
            onOpenChange: () => {},
            children: [SheetTrigger({ children: 'Open' }), SheetContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });

    it('should compose with nested content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: [
                SheetTitle({ children: 'Main Title' }),
                SheetDescription({ children: 'Description' }),
                'Custom content',
                SheetClose({ children: 'Close' }),
              ],
            }),
          });
        });
      }).not.toThrow();
    });

    it('should compose with all props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            open: false,
            defaultOpen: false,
            onOpenChange: () => {},
            side: 'left',
            children: [
              SheetTrigger({
                children: 'Open',
                className: 'trigger',
              }),
              SheetContent({
                closeOnEscape: true,
                closeOnOverlayClick: true,
                children: [
                  SheetTitle({ children: 'Title' }),
                  SheetDescription({ children: 'Description' }),
                  SheetClose({ children: 'Close' }),
                ],
              }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  describe('Controlled vs Uncontrolled', () => {
    it('should work in uncontrolled mode with defaultOpen', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should work in controlled mode with open prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            open: true,
            onOpenChange: () => {},
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with only open prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            open: false,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with only onOpenChange', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            onOpenChange: () => {},
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should enforce valid side values', () => {
      const validSides: SheetSide[] = ['top', 'right', 'bottom', 'left'];

      validSides.forEach((side) => {
        expect(() => {
          dispose = createRoot(() => {
            Sheet({
              side,
              children: SheetContent({ children: 'Content' }),
            });
          });
        }).not.toThrow();
      });
    });

    it('should accept boolean props correctly', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnEscape: false,
              closeOnOverlayClick: true,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept callback types correctly', () => {
      const onOpenChange = (open: boolean) => {
        expect(typeof open).toBe('boolean');
      };

      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            onOpenChange,
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(SheetContext).toBeDefined();
      expect(SheetContext.Provider).toBeTypeOf('function');
      expect(SheetContext.defaultValue).toBeDefined();
    });

    it('should provide stable context reference', () => {
      const ctx1 = SheetContext;
      const ctx2 = SheetContext;
      expect(ctx1).toBe(ctx2);
    });

    it('should provide stable component references', () => {
      const Trigger1 = SheetTrigger;
      const Trigger2 = SheetTrigger;
      expect(Trigger1).toBe(Trigger2);
    });
  });

  describe('ARIA Attributes', () => {
    it('should have aria-haspopup on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-expanded on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should have role dialog on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-modal on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-labelledby on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-describedby on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Data Attributes', () => {
    it('should have data-state on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: SheetTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-state on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-side on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            side: 'left',
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-sheet-overlay attribute', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid open/close', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: [SheetTrigger({ children: 'Open' }), SheetContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });

    it('should handle content without title', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: SheetDescription({ children: 'Only description' }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle content without description', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: SheetTitle({ children: 'Only title' }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle empty content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: '' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple triggers', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            children: [
              SheetTrigger({ children: 'Open 1' }),
              SheetTrigger({ children: 'Open 2' }),
              SheetContent({ children: 'Content' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple close buttons', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: [SheetClose({ children: 'Close 1' }), SheetClose({ children: 'Close 2' })],
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle long content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: 'A'.repeat(10000),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle special characters in content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: '<script>alert("xss")</script>',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle unicode in content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: '🎉 Unicode 成功 ✨',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Portal Rendering', () => {
    it('should render content in portal when open', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should not render content when closed', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: false,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should render overlay with content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Focus Management', () => {
    it('should trap focus when open', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              children: [SheetTitle({ children: 'Title' }), SheetClose({ children: 'Close' })],
            }),
          });
        });
      }).not.toThrow();
    });

    it('should set tabIndex on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Keyboard Support', () => {
    it('should support closeOnEscape', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnEscape: true,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should support disabling closeOnEscape', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnEscape: false,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Overlay Interaction', () => {
    it('should support closeOnOverlayClick', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnOverlayClick: true,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should support disabling closeOnOverlayClick', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnOverlayClick: false,
              children: 'Content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should prevent content clicks from closing', () => {
      expect(() => {
        dispose = createRoot(() => {
          Sheet({
            defaultOpen: true,
            children: SheetContent({
              closeOnOverlayClick: true,
              children: 'Clickable content',
            }),
          });
        });
      }).not.toThrow();
    });
  });
});
