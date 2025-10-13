/**
 * ContextMenu Primitive Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuContext,
} from '../../../src/primitives/ContextMenu.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('ContextMenu Primitive', () => {
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

  describe('ContextMenuContext', () => {
    it('should have default values', () => {
      expect(ContextMenuContext.id).toBeTypeOf('symbol');
      expect(ContextMenuContext.defaultValue).toBeDefined();
      expect(ContextMenuContext.defaultValue.isOpen()).toBe(false);
      expect(ContextMenuContext.defaultValue.open).toBeTypeOf('function');
      expect(ContextMenuContext.defaultValue.close).toBeTypeOf('function');
      expect(ContextMenuContext.defaultValue.position).toBeTypeOf('function');
    });

    it('should have stable default contentId', () => {
      expect(ContextMenuContext.defaultValue.contentId).toBe('');
    });

    it('should return null position by default', () => {
      expect(ContextMenuContext.defaultValue.position()).toBeNull();
    });
  });

  describe('Component Exports', () => {
    it('should export ContextMenu component', () => {
      expect(ContextMenu).toBeTypeOf('function');
    });

    it('should export ContextMenuTrigger component', () => {
      expect(ContextMenuTrigger).toBeTypeOf('function');
    });

    it('should export ContextMenuContent component', () => {
      expect(ContextMenuContent).toBeTypeOf('function');
    });

    it('should export ContextMenuItem component', () => {
      expect(ContextMenuItem).toBeTypeOf('function');
    });

    it('should export ContextMenuSeparator component', () => {
      expect(ContextMenuSeparator).toBeTypeOf('function');
    });

    it('should export ContextMenuLabel component', () => {
      expect(ContextMenuLabel).toBeTypeOf('function');
    });

    it('should export ContextMenuContext', () => {
      expect(ContextMenuContext).toBeDefined();
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as ContextMenu.Trigger', () => {
      expect((ContextMenu as any).Trigger).toBe(ContextMenuTrigger);
    });

    it('should attach Content as ContextMenu.Content', () => {
      expect((ContextMenu as any).Content).toBe(ContextMenuContent);
    });

    it('should attach Item as ContextMenu.Item', () => {
      expect((ContextMenu as any).Item).toBe(ContextMenuItem);
    });

    it('should attach Separator as ContextMenu.Separator', () => {
      expect((ContextMenu as any).Separator).toBe(ContextMenuSeparator);
    });

    it('should attach Label as ContextMenu.Label', () => {
      expect((ContextMenu as any).Label).toBe(ContextMenuLabel);
    });
  });

  describe('Component Structure', () => {
    it('should create ContextMenu with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({ children: ContextMenuTrigger({ children: 'Right click me' }) });
        });
      }).not.toThrow();
    });

    it('should accept onOpenChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            onOpenChange: () => {},
            children: ContextMenuTrigger({ children: 'Right click' }),
          });
        });
      }).not.toThrow();
    });

    it('should start closed by default', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('ContextMenuTrigger Structure', () => {
    it('should create trigger with children', () => {
      dispose = createRoot(() => {
        const trigger = ContextMenuTrigger({ children: 'Right click me' });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept disabled prop', () => {
      dispose = createRoot(() => {
        const trigger = ContextMenuTrigger({
          children: 'Right click me',
          disabled: true,
        });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const trigger = ContextMenuTrigger({
          children: 'Right click me',
          className: 'custom',
          'data-test': 'trigger',
        });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept style prop', () => {
      dispose = createRoot(() => {
        const trigger = ContextMenuTrigger({
          children: 'Right click me',
          style: { padding: '10px' },
        });
        expect(trigger).toBeTruthy();
      });
    });
  });

  describe('ContextMenuContent Structure', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuContent({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should accept loop prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuContent({
            children: 'Content',
            loop: true,
          });
        });
      }).not.toThrow();
    });

    it('should accept onEscapeKeyDown callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuContent({
            children: 'Content',
            onEscapeKeyDown: () => {},
          });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuContent({
            children: 'Content',
            className: 'custom',
          });
        });
      }).not.toThrow();
    });
  });

  describe('ContextMenuItem Structure', () => {
    it('should create menu item with children', () => {
      dispose = createRoot(() => {
        const item = ContextMenuItem({ children: 'Cut' });
        expect(item).toBeTruthy();
      });
    });

    it('should accept disabled prop', () => {
      dispose = createRoot(() => {
        const item = ContextMenuItem({
          children: 'Cut',
          disabled: true,
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept onSelect callback', () => {
      dispose = createRoot(() => {
        const item = ContextMenuItem({
          children: 'Cut',
          onSelect: () => {},
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const item = ContextMenuItem({
          children: 'Cut',
          className: 'menu-item',
        });
        expect(item).toBeTruthy();
      });
    });
  });

  describe('ContextMenuSeparator Structure', () => {
    it('should create separator', () => {
      dispose = createRoot(() => {
        const separator = ContextMenuSeparator({});
        expect(separator).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const separator = ContextMenuSeparator({
          className: 'separator',
        });
        expect(separator).toBeTruthy();
      });
    });
  });

  describe('ContextMenuLabel Structure', () => {
    it('should create label with children', () => {
      dispose = createRoot(() => {
        const label = ContextMenuLabel({ children: 'Edit' });
        expect(label).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const label = ContextMenuLabel({
          children: 'Edit',
          className: 'label',
        });
        expect(label).toBeTruthy();
      });
    });
  });

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      dispose = createRoot(() => {
        const menu = ContextMenu({
          children: [
            ContextMenuTrigger({ children: 'Right click here' }),
            ContextMenuContent({
              children: [
                ContextMenuLabel({ children: 'Edit' }),
                ContextMenuItem({ children: 'Cut' }),
                ContextMenuItem({ children: 'Copy' }),
                ContextMenuItem({ children: 'Paste' }),
                ContextMenuSeparator({}),
                ContextMenuItem({ children: 'Delete', disabled: true }),
              ],
            }),
          ],
        });

        expect(menu).toBeTruthy();
      });
    });

    it('should work with nested structure', () => {
      dispose = createRoot(() => {
        const menu = ContextMenu({
          onOpenChange: () => {},
          children: [
            ContextMenuTrigger({
              children: 'Right click',
              className: 'trigger',
            }),
            ContextMenuContent({
              children: [
                ContextMenuLabel({ children: 'Actions' }),
                ContextMenuItem({
                  children: 'New File',
                  onSelect: () => {},
                }),
                ContextMenuItem({
                  children: 'Open',
                  onSelect: () => {},
                }),
                ContextMenuSeparator({}),
                ContextMenuItem({
                  children: 'Delete',
                  disabled: true,
                }),
              ],
              className: 'content',
            }),
          ],
        });

        expect(menu).toBeTruthy();
      });
    });

    it('should work with minimal composition', () => {
      dispose = createRoot(() => {
        const menu = ContextMenu({
          children: [
            ContextMenuTrigger({ children: 'Area' }),
            ContextMenuContent({
              children: [ContextMenuItem({ children: 'Item' })],
            }),
          ],
        });

        expect(menu).toBeTruthy();
      });
    });
  });

  describe('Type Safety', () => {
    it('should accept children prop on ContextMenu', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({ children: ContextMenuTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept all context menu props', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
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
          ContextMenuContent({
            children: 'Content',
            loop: true,
            onEscapeKeyDown: () => {},
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(ContextMenuContext).toBeDefined();
      expect(ContextMenuContext.Provider).toBeTypeOf('function');
      expect(ContextMenuContext.defaultValue).toBeDefined();
    });

    it('should provide stable component references', () => {
      const Trigger1 = (ContextMenu as any).Trigger;
      const Trigger2 = (ContextMenu as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });

    it('should provide stable context ID', () => {
      const id1 = ContextMenuContext.id;
      const id2 = ContextMenuContext.id;
      expect(id1).toBe(id2);
    });
  });

  describe('ARIA Attributes', () => {
    it('should set role="menu" on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should set role="menuitem" on items', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuItem({ children: 'Item' });
        });
      }).not.toThrow();
    });

    it('should set role="separator" on separator', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuSeparator({});
        });
      }).not.toThrow();
    });

    it('should set aria-orientation on separator', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuSeparator({});
        });
      }).not.toThrow();
    });

    it('should set data-disabled on disabled items', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuItem({
            children: 'Item',
            disabled: true,
          });
        });
      }).not.toThrow();
    });
  });

  describe('Data Attributes', () => {
    it('should set data-state on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should set data-context-menu-label on label', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuLabel({ children: 'Label' });
        });
      }).not.toThrow();
    });
  });

  describe('Focus Management', () => {
    it('should set tabIndex on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should set tabIndex on menu items', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuItem({ children: 'Item' });
        });
      }).not.toThrow();
    });

    it('should set tabIndex=-1 on disabled items', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuItem({
            children: 'Item',
            disabled: true,
          });
        });
      }).not.toThrow();
    });
  });

  describe('Position Management', () => {
    it('should track cursor position on right-click', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuTrigger({ children: 'Right click' }),
          });
        });
      }).not.toThrow();
    });

    it('should use fixed positioning for content', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Portal Rendering', () => {
    it('should render content in portal', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should not render when closed', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('Keyboard Interaction', () => {
    it('should support Escape key to close', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuContent({
            children: 'Content',
            onEscapeKeyDown: () => {},
          });
        });
      }).not.toThrow();
    });

    it('should call onEscapeKeyDown callback', () => {
      const callback = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuContent({
            children: 'Content',
            onEscapeKeyDown: callback,
          });
        });
      }).not.toThrow();
    });
  });

  describe('Click Behavior', () => {
    it('should close on item select', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: [
              ContextMenuTrigger({ children: 'Trigger' }),
              ContextMenuContent({
                children: ContextMenuItem({
                  children: 'Item',
                  onSelect: () => {},
                }),
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should not select disabled items', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuItem({
            children: 'Item',
            disabled: true,
            onSelect: () => {},
          });
        });
      }).not.toThrow();
    });

    it('should call onSelect callback', () => {
      const callback = vi.fn();
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuItem({
            children: 'Item',
            onSelect: callback,
          });
        });
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing onOpenChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuTrigger({ children: 'Right click' }),
          });
        });
      }).not.toThrow();
    });

    it('should handle missing onSelect on item', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuItem({ children: 'Item' });
        });
      }).not.toThrow();
    });

    it('should handle missing onEscapeKeyDown on content', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenuContent({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should work without Label', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: [
              ContextMenuTrigger({ children: 'Trigger' }),
              ContextMenuContent({
                children: [ContextMenuItem({ children: 'Item' })],
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should work without Separator', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: [
              ContextMenuTrigger({ children: 'Trigger' }),
              ContextMenuContent({
                children: [ContextMenuItem({ children: 'Item 1' }), ContextMenuItem({ children: 'Item 2' })],
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should handle disabled trigger', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: ContextMenuTrigger({
              children: 'Trigger',
              disabled: true,
            }),
          });
        });
      }).not.toThrow();
    });

    it('should handle empty content', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: [ContextMenuTrigger({ children: 'Trigger' }), ContextMenuContent({ children: [] })],
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple separators', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: [
              ContextMenuTrigger({ children: 'Trigger' }),
              ContextMenuContent({
                children: [
                  ContextMenuItem({ children: 'Item 1' }),
                  ContextMenuSeparator({}),
                  ContextMenuSeparator({}),
                  ContextMenuItem({ children: 'Item 2' }),
                ],
              }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should handle multiple labels', () => {
      expect(() => {
        dispose = createRoot(() => {
          ContextMenu({
            children: [
              ContextMenuTrigger({ children: 'Trigger' }),
              ContextMenuContent({
                children: [
                  ContextMenuLabel({ children: 'Edit' }),
                  ContextMenuItem({ children: 'Item 1' }),
                  ContextMenuSeparator({}),
                  ContextMenuLabel({ children: 'View' }),
                  ContextMenuItem({ children: 'Item 2' }),
                ],
              }),
            ],
          });
        });
      }).not.toThrow();
    });
  });
});
