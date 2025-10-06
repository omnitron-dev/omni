/**
 * Dropdown Menu Primitive Tests
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItemIndicator,
  DropdownMenuShortcut,
  DropdownMenuContext,
  RadioGroupContext,
} from '../../../src/primitives/DropdownMenu.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Dropdown Menu Primitive', () => {
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
    document.querySelectorAll('.aether-portal').forEach((el) => el.remove());
  });

  describe('Context', () => {
    it('should have DropdownMenuContext with default values', () => {
      expect(DropdownMenuContext).toBeDefined();
      expect(DropdownMenuContext.defaultValue).toBeDefined();
      expect(DropdownMenuContext.defaultValue.isOpen()).toBe(false);
      expect(DropdownMenuContext.defaultValue.open).toBeTypeOf('function');
      expect(DropdownMenuContext.defaultValue.close).toBeTypeOf('function');
      expect(DropdownMenuContext.defaultValue.toggle).toBeTypeOf('function');
    });

    it('should have RadioGroupContext with default values', () => {
      expect(RadioGroupContext).toBeDefined();
      expect(RadioGroupContext.defaultValue).toBeDefined();
      expect(RadioGroupContext.defaultValue.value()).toBe('');
      expect(RadioGroupContext.defaultValue.setValue).toBeTypeOf('function');
    });
  });

  describe('Component Exports', () => {
    it('should export DropdownMenu component', () => {
      expect(DropdownMenu).toBeTypeOf('function');
    });

    it('should export DropdownMenuTrigger component', () => {
      expect(DropdownMenuTrigger).toBeTypeOf('function');
    });

    it('should export DropdownMenuContent component', () => {
      expect(DropdownMenuContent).toBeTypeOf('function');
    });

    it('should export DropdownMenuItem component', () => {
      expect(DropdownMenuItem).toBeTypeOf('function');
    });

    it('should export DropdownMenuCheckboxItem component', () => {
      expect(DropdownMenuCheckboxItem).toBeTypeOf('function');
    });

    it('should export DropdownMenuRadioGroup component', () => {
      expect(DropdownMenuRadioGroup).toBeTypeOf('function');
    });

    it('should export DropdownMenuRadioItem component', () => {
      expect(DropdownMenuRadioItem).toBeTypeOf('function');
    });

    it('should export DropdownMenuLabel component', () => {
      expect(DropdownMenuLabel).toBeTypeOf('function');
    });

    it('should export DropdownMenuSeparator component', () => {
      expect(DropdownMenuSeparator).toBeTypeOf('function');
    });

    it('should export DropdownMenuItemIndicator component', () => {
      expect(DropdownMenuItemIndicator).toBeTypeOf('function');
    });

    it('should export DropdownMenuShortcut component', () => {
      expect(DropdownMenuShortcut).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as DropdownMenu.Trigger', () => {
      expect((DropdownMenu as any).Trigger).toBe(DropdownMenuTrigger);
    });

    it('should attach Content as DropdownMenu.Content', () => {
      expect((DropdownMenu as any).Content).toBe(DropdownMenuContent);
    });

    it('should attach Item as DropdownMenu.Item', () => {
      expect((DropdownMenu as any).Item).toBe(DropdownMenuItem);
    });

    it('should attach CheckboxItem as DropdownMenu.CheckboxItem', () => {
      expect((DropdownMenu as any).CheckboxItem).toBe(DropdownMenuCheckboxItem);
    });

    it('should attach RadioGroup as DropdownMenu.RadioGroup', () => {
      expect((DropdownMenu as any).RadioGroup).toBe(DropdownMenuRadioGroup);
    });

    it('should attach RadioItem as DropdownMenu.RadioItem', () => {
      expect((DropdownMenu as any).RadioItem).toBe(DropdownMenuRadioItem);
    });

    it('should attach Label as DropdownMenu.Label', () => {
      expect((DropdownMenu as any).Label).toBe(DropdownMenuLabel);
    });

    it('should attach Separator as DropdownMenu.Separator', () => {
      expect((DropdownMenu as any).Separator).toBe(DropdownMenuSeparator);
    });

    it('should attach ItemIndicator as DropdownMenu.ItemIndicator', () => {
      expect((DropdownMenu as any).ItemIndicator).toBe(DropdownMenuItemIndicator);
    });

    it('should attach Shortcut as DropdownMenu.Shortcut', () => {
      expect((DropdownMenu as any).Shortcut).toBe(DropdownMenuShortcut);
    });
  });

  describe('Component Structure', () => {
    it('should create DropdownMenu with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenu({ children: DropdownMenuTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept defaultOpen prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenu({
            defaultOpen: true,
            children: DropdownMenuContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onOpenChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenu({
            onOpenChange: () => {},
            children: DropdownMenuTrigger({ children: 'Open' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('DropdownMenuTrigger Structure', () => {
    it('should create trigger with children', () => {
      dispose = createRoot(() => {
        const trigger = DropdownMenuTrigger({ children: 'Open' });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept disabled prop', () => {
      dispose = createRoot(() => {
        const trigger = DropdownMenuTrigger({
          children: 'Open',
          disabled: true,
        });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const trigger = DropdownMenuTrigger({
          children: 'Open',
          className: 'custom',
          'data-test': 'trigger',
        });
        expect(trigger).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuContent Structure', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenuContent({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should accept positioning props', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenuContent({
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

    it('should accept loop prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenuContent({
            children: 'Content',
            loop: true,
          });
        });
      }).not.toThrow();
    });
  });

  describe('DropdownMenuItem Structure', () => {
    it('should create item with children', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuItem({ children: 'Item' });
        expect(item).toBeTruthy();
      });
    });

    it('should accept disabled prop', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuItem({
          children: 'Item',
          disabled: true,
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept textValue prop', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuItem({
          children: 'Item',
          textValue: 'custom text',
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept onSelect callback', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuItem({
          children: 'Item',
          onSelect: () => {},
        });
        expect(item).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuCheckboxItem Structure', () => {
    it('should create checkbox item with children', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuCheckboxItem({ children: 'Checkbox' });
        expect(item).toBeTruthy();
      });
    });

    it('should accept defaultChecked prop', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuCheckboxItem({
          children: 'Checkbox',
          defaultChecked: true,
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept onCheckedChange callback', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuCheckboxItem({
          children: 'Checkbox',
          onCheckedChange: () => {},
        });
        expect(item).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuRadioGroup Structure', () => {
    it('should create radio group with children', () => {
      dispose = createRoot(() => {
        const group = DropdownMenuRadioGroup({
          children: DropdownMenuRadioItem({ value: 'test', children: 'Radio' }),
        });
        expect(group).toBeTruthy();
      });
    });

    it('should accept defaultValue prop', () => {
      dispose = createRoot(() => {
        const group = DropdownMenuRadioGroup({
          defaultValue: 'value1',
          children: DropdownMenuRadioItem({ value: 'value1', children: 'Radio' }),
        });
        expect(group).toBeTruthy();
      });
    });

    it('should accept onValueChange callback', () => {
      dispose = createRoot(() => {
        const group = DropdownMenuRadioGroup({
          onValueChange: () => {},
          children: DropdownMenuRadioItem({ value: 'test', children: 'Radio' }),
        });
        expect(group).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuRadioItem Structure', () => {
    it('should create radio item with value', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuRadioItem({
          value: 'test',
          children: 'Radio',
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept disabled prop', () => {
      dispose = createRoot(() => {
        const item = DropdownMenuRadioItem({
          value: 'test',
          disabled: true,
          children: 'Radio',
        });
        expect(item).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuLabel Structure', () => {
    it('should create label with children', () => {
      dispose = createRoot(() => {
        const label = DropdownMenuLabel({ children: 'Label' });
        expect(label).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuSeparator Structure', () => {
    it('should create separator', () => {
      dispose = createRoot(() => {
        const separator = DropdownMenuSeparator({});
        expect(separator).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuItemIndicator Structure', () => {
    it('should create indicator with children', () => {
      dispose = createRoot(() => {
        const indicator = DropdownMenuItemIndicator({ children: '✓' });
        expect(indicator).toBeTruthy();
      });
    });
  });

  describe('DropdownMenuShortcut Structure', () => {
    it('should create shortcut with children', () => {
      dispose = createRoot(() => {
        const shortcut = DropdownMenuShortcut({ children: '⌘N' });
        expect(shortcut).toBeTruthy();
      });
    });
  });

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      dispose = createRoot(() => {
        const menu = DropdownMenu({
          children: [
            DropdownMenuTrigger({ children: 'Open' }),
            DropdownMenuContent({
              children: [
                DropdownMenuLabel({ children: 'Label' }),
                DropdownMenuItem({ children: 'Item 1' }),
                DropdownMenuItem({ children: 'Item 2', disabled: true }),
                DropdownMenuSeparator({}),
                DropdownMenuCheckboxItem({ children: 'Checkbox' }),
                DropdownMenuSeparator({}),
                DropdownMenuRadioGroup({
                  children: [
                    DropdownMenuRadioItem({ value: 'v1', children: 'Radio 1' }),
                    DropdownMenuRadioItem({ value: 'v2', children: 'Radio 2' }),
                  ],
                }),
              ],
            }),
          ],
        });

        expect(menu).toBeTruthy();
      });
    });

    it('should work with nested structure', () => {
      dispose = createRoot(() => {
        const menu = DropdownMenu({
          defaultOpen: false,
          onOpenChange: () => {},
          children: [
            DropdownMenuTrigger({
              children: 'Actions',
              className: 'trigger',
            }),
            DropdownMenuContent({
              side: 'bottom' as const,
              align: 'start' as const,
              children: [
                DropdownMenuItem({
                  children: [
                    'New',
                    DropdownMenuShortcut({ children: '⌘N' }),
                  ],
                }),
                DropdownMenuItem({
                  children: 'Open',
                  onSelect: () => {},
                }),
                DropdownMenuSeparator({}),
                DropdownMenuCheckboxItem({
                  children: [
                    DropdownMenuItemIndicator({ children: '✓' }),
                    'Show Bookmarks',
                  ],
                  defaultChecked: true,
                }),
              ],
              className: 'content',
            }),
          ],
        });

        expect(menu).toBeTruthy();
      });
    });
  });

  describe('Type Safety', () => {
    it('should accept children prop on DropdownMenu', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenu({ children: DropdownMenuTrigger({ children: 'Open' }) });
        });
      }).not.toThrow();
    });

    it('should accept all dropdown menu props', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenu({
            children: DropdownMenuContent({ children: 'Content' }),
            defaultOpen: true,
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
          DropdownMenuContent({
            children: 'Content',
            side: 'top' as const,
            align: 'start' as const,
            sideOffset: 10,
            alignOffset: 5,
            avoidCollisions: true,
            collisionPadding: 20,
            loop: true,
            onEscapeKeyDown: () => {},
            onPointerDownOutside: () => {},
          });
        });
      }).not.toThrow();
    });

    it('should require value prop on RadioItem', () => {
      expect(() => {
        dispose = createRoot(() => {
          DropdownMenuRadioItem({
            value: 'test',
            children: 'Radio',
          });
        });
      }).not.toThrow();
    });
  });

  describe('API Surface', () => {
    it('should export context for advanced use cases', () => {
      expect(DropdownMenuContext).toBeDefined();
      expect(DropdownMenuContext.Provider).toBeTypeOf('function');
      expect(DropdownMenuContext.defaultValue).toBeDefined();
    });

    it('should export RadioGroupContext', () => {
      expect(RadioGroupContext).toBeDefined();
      expect(RadioGroupContext.Provider).toBeTypeOf('function');
      expect(RadioGroupContext.defaultValue).toBeDefined();
    });

    it('should provide stable component references', () => {
      const Trigger1 = (DropdownMenu as any).Trigger;
      const Trigger2 = (DropdownMenu as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });
  });
});
