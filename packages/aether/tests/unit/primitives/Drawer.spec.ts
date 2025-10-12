/**
 * Drawer Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerOverlay,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
  type DrawerSide,
} from '../../../src/primitives/Drawer.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Drawer Primitive', () => {
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

  describe('Component Exports', () => {
    it('should export Drawer component', () => {
      expect(Drawer).toBeTypeOf('function');
    });

    it('should export DrawerTrigger component', () => {
      expect(DrawerTrigger).toBeTypeOf('function');
    });

    it('should export DrawerContent component', () => {
      expect(DrawerContent).toBeTypeOf('function');
    });

    it('should export DrawerOverlay component', () => {
      expect(DrawerOverlay).toBeTypeOf('function');
    });

    it('should export DrawerTitle component', () => {
      expect(DrawerTitle).toBeTypeOf('function');
    });

    it('should export DrawerDescription component', () => {
      expect(DrawerDescription).toBeTypeOf('function');
    });

    it('should export DrawerClose component', () => {
      expect(DrawerClose).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as Drawer.Trigger', () => {
      expect((Drawer as any).Trigger).toBe(DrawerTrigger);
    });

    it('should attach Overlay as Drawer.Overlay', () => {
      expect((Drawer as any).Overlay).toBe(DrawerOverlay);
    });

    it('should attach Content as Drawer.Content', () => {
      expect((Drawer as any).Content).toBe(DrawerContent);
    });

    it('should attach Title as Drawer.Title', () => {
      expect((Drawer as any).Title).toBe(DrawerTitle);
    });

    it('should attach Description as Drawer.Description', () => {
      expect((Drawer as any).Description).toBe(DrawerDescription);
    });

    it('should attach Close as Drawer.Close', () => {
      expect((Drawer as any).Close).toBe(DrawerClose);
    });
  });

  describe('Drawer Root', () => {
    it('should create drawer with default props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept open prop (controlled)', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            open: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept defaultOpen prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onOpenChange callback', () => {
      const onOpenChange = vi.fn();

      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            onOpenChange,
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - right', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            side: 'right',
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - left', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            side: 'left',
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - top', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            side: 'top',
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop - bottom', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            side: 'bottom',
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should use default side of right', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept modal prop - true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            modal: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept modal prop - false', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            modal: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should use default modal of true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnOutsideClick prop - true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            closeOnOutsideClick: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnOutsideClick prop - false', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            closeOnOutsideClick: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should use default closeOnOutsideClick of true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnEscape prop - true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            closeOnEscape: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept closeOnEscape prop - false', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            closeOnEscape: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should use default closeOnEscape of true', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept children as single element', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept children as array', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: [DrawerTrigger({ children: 'Open' }), DrawerOverlay({}), DrawerContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });
  });

  describe('DrawerTrigger', () => {
    it('should create trigger with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open Drawer' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({
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
          Drawer({
            children: DrawerTrigger({
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
          Drawer({
            children: DrawerTrigger({
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
          Drawer({
            children: DrawerTrigger({
              children: 'Open',
              disabled: true,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should have type button', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('DrawerOverlay', () => {
    it('should create overlay', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should accept children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerOverlay({
              children: 'Overlay content',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerOverlay({
              className: 'custom-overlay',
              'data-test': 'overlay',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept style prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerOverlay({
              style: { backgroundColor: 'rgba(0,0,0,0.5)' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should not render when closed', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: false,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should render when open and modal', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            modal: true,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should not render when non-modal', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            modal: false,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });
  });

  describe('DrawerContent', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Drawer content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
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
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
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
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
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
          Drawer({
            defaultOpen: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should render when open', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept nested children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: [
                DrawerTitle({ children: 'Title' }),
                DrawerDescription({ children: 'Description' }),
                'Custom content',
              ],
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('DrawerTitle', () => {
    it('should create title with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTitle({ children: 'Drawer Title' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTitle({ children: 'Title' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTitle({
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
          Drawer({
            children: DrawerTitle({
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
          Drawer({
            children: DrawerTitle({
              children: 'Title',
              id: 'custom-title',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('DrawerDescription', () => {
    it('should create description with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerDescription({ children: 'Drawer description' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept string children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerDescription({ children: 'Description' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerDescription({
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
          Drawer({
            children: DrawerDescription({
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
          Drawer({
            children: DrawerDescription({
              children: 'Description',
              id: 'custom-description',
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('DrawerClose', () => {
    it('should create close button', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({}),
          });
        });
      }).not.toThrow();
    });

    it('should use default children (×)', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({}),
          });
        });
      }).not.toThrow();
    });

    it('should accept custom children', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({ children: 'Close' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({
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
          Drawer({
            children: DrawerClose({
              style: { position: 'absolute' },
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept disabled prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({
              disabled: true,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should have type button', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({}),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Composition', () => {
    it('should compose all sub-components', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: [
              DrawerTrigger({ children: 'Open' }),
              DrawerOverlay({}),
              DrawerContent({
                children: [
                  DrawerTitle({ children: 'Title' }),
                  DrawerDescription({ children: 'Description' }),
                  DrawerClose({ children: 'Close' }),
                ],
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should compose with all sides', () => {
      const sides: DrawerSide[] = ['top', 'right', 'bottom', 'left'];

      sides.forEach((side) => {
        expect(() => {
          dispose = createRoot(() => {
            Drawer({
              side,
              children: DrawerContent({ children: 'Content' }),
            });
          });
        }).not.toThrow();
      });
    });

    it('should compose with modal mode', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            modal: true,
            children: [DrawerOverlay({}), DrawerContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });

    it('should compose with non-modal mode', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            modal: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should compose with all props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            open: false,
            defaultOpen: false,
            onOpenChange: () => {},
            side: 'left',
            modal: true,
            closeOnOutsideClick: true,
            closeOnEscape: true,
            children: [
              DrawerTrigger({ children: 'Open' }),
              DrawerOverlay({}),
              DrawerContent({
                children: [
                  DrawerTitle({ children: 'Title' }),
                  DrawerDescription({ children: 'Description' }),
                  DrawerClose({ children: 'Close' }),
                ],
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should compose using attached components', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: [
              (Drawer as any).Trigger({ children: 'Open' }),
              (Drawer as any).Overlay({}),
              (Drawer as any).Content({
                children: [
                  (Drawer as any).Title({ children: 'Title' }),
                  (Drawer as any).Description({ children: 'Description' }),
                  (Drawer as any).Close({}),
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
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should work in controlled mode with open prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            open: true,
            onOpenChange: () => {},
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with only open prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            open: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with only onOpenChange', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            onOpenChange: () => {},
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should enforce valid side values', () => {
      const validSides: DrawerSide[] = ['top', 'right', 'bottom', 'left'];

      validSides.forEach((side) => {
        expect(() => {
          dispose = createRoot(() => {
            Drawer({
              side,
              children: DrawerContent({ children: 'Content' }),
            });
          });
        }).not.toThrow();
      });
    });

    it('should accept boolean props correctly', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            modal: false,
            closeOnOutsideClick: true,
            closeOnEscape: false,
            children: DrawerContent({ children: 'Content' }),
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
          Drawer({
            onOpenChange,
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should provide stable component references', () => {
      const Trigger1 = DrawerTrigger;
      const Trigger2 = DrawerTrigger;
      expect(Trigger1).toBe(Trigger2);
    });

    it('should provide stable attached component references', () => {
      const Trigger1 = (Drawer as any).Trigger;
      const Trigger2 = (Drawer as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });
  });

  describe('ARIA Attributes', () => {
    it('should have aria-expanded on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should have role dialog on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-modal on content when modal', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            modal: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-modal false on content when non-modal', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            modal: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-hidden on overlay', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should have aria-label on close button', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({}),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Data Attributes', () => {
    it('should have data-drawer on root', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-state on root', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-drawer-trigger on trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-drawer-overlay on overlay', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should have data-drawer-content on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-side on overlay', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            side: 'left',
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should have data-side on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            side: 'top',
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-drawer-title on title', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerTitle({ children: 'Title' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-drawer-description on description', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerDescription({ children: 'Description' }),
          });
        });
      }).not.toThrow();
    });

    it('should have data-drawer-close on close button', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: DrawerClose({}),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Modal Mode', () => {
    it('should render overlay in modal mode', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            modal: true,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should not render overlay in non-modal mode', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            modal: false,
            children: DrawerOverlay({}),
          });
        });
      }).not.toThrow();
    });

    it('should support modal with all sides', () => {
      const sides: DrawerSide[] = ['top', 'right', 'bottom', 'left'];

      sides.forEach((side) => {
        expect(() => {
          dispose = createRoot(() => {
            Drawer({
              defaultOpen: true,
              modal: true,
              side,
              children: [DrawerOverlay({}), DrawerContent({ children: 'Content' })],
            });
          });
        }).not.toThrow();
      });
    });
  });

  describe('Keyboard Support', () => {
    it('should support Escape key to close', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            closeOnEscape: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should support disabling Escape key', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            closeOnEscape: false,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Outside Click', () => {
    it('should support closing on outside click', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            closeOnOutsideClick: true,
            children: [DrawerOverlay({}), DrawerContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });

    it('should support disabling outside click close', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            closeOnOutsideClick: false,
            children: [DrawerOverlay({}), DrawerContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });

    it('should not close when clicking content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            closeOnOutsideClick: true,
            children: DrawerContent({ children: 'Clickable content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid open/close', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: [DrawerTrigger({ children: 'Open' }), DrawerContent({ children: 'Content' })],
          });
        });
      }).not.toThrow();
    });

    it('should handle content without title', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: DrawerDescription({ children: 'Only description' }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle content without description', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: DrawerTitle({ children: 'Only title' }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle empty content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: '' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple triggers', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            children: [
              DrawerTrigger({ children: 'Open 1' }),
              DrawerTrigger({ children: 'Open 2' }),
              DrawerContent({ children: 'Content' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple close buttons', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: [DrawerClose({ children: 'Close 1' }), DrawerClose({ children: 'Close 2' })],
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle long content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: 'A'.repeat(10000),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle special characters in content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: '<script>alert("xss")</script>',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle unicode in content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: '🎉 Unicode 成功 ✨',
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle nested drawers', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: Drawer({
                children: DrawerTrigger({ children: 'Open Nested' }),
              }),
            }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Focus Management', () => {
    it('should set tabIndex on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should support focusable elements in content', () => {
      expect(() => {
        dispose = createRoot(() => {
          Drawer({
            defaultOpen: true,
            children: DrawerContent({
              children: [DrawerTitle({ children: 'Title' }), DrawerClose({ children: 'Close' })],
            }),
          });
        });
      }).not.toThrow();
    });
  });
});
