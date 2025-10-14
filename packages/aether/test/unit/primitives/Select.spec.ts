/**
 * Select Primitive Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  SelectContext,
} from '../../../src/primitives/Select.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('Select Primitive', () => {
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

  describe('SelectContext', () => {
    it('should have SelectContext with default values', () => {
      expect(SelectContext.defaultValue).toBeDefined();
      expect(SelectContext.defaultValue.value()).toBe('');
      expect(SelectContext.defaultValue.isOpen()).toBe(false);
      expect(SelectContext.defaultValue.disabled()).toBe(false);
      expect(SelectContext.defaultValue.required()).toBe(false);
      expect(SelectContext.defaultValue.name()).toBe('');
    });

    it('should have stable default IDs', () => {
      expect(SelectContext.defaultValue.triggerId).toBe('');
      expect(SelectContext.defaultValue.valueId).toBe('');
      expect(SelectContext.defaultValue.contentId).toBe('');
    });

    it('should have item management functions', () => {
      expect(SelectContext.defaultValue.registerItem).toBeTypeOf('function');
      expect(SelectContext.defaultValue.unregisterItem).toBeTypeOf('function');
      expect(SelectContext.defaultValue.items()).toEqual([]);
    });
  });

  describe('Component Exports', () => {
    it('should export Select component', () => {
      expect(Select).toBeTypeOf('function');
    });

    it('should export SelectTrigger component', () => {
      expect(SelectTrigger).toBeTypeOf('function');
    });

    it('should export SelectValue component', () => {
      expect(SelectValue).toBeTypeOf('function');
    });

    it('should export SelectIcon component', () => {
      expect(SelectIcon).toBeTypeOf('function');
    });

    it('should export SelectContent component', () => {
      expect(SelectContent).toBeTypeOf('function');
    });

    it('should export SelectViewport component', () => {
      expect(SelectViewport).toBeTypeOf('function');
    });

    it('should export SelectItem component', () => {
      expect(SelectItem).toBeTypeOf('function');
    });

    it('should export SelectItemText component', () => {
      expect(SelectItemText).toBeTypeOf('function');
    });

    it('should export SelectItemIndicator component', () => {
      expect(SelectItemIndicator).toBeTypeOf('function');
    });

    it('should export SelectGroup component', () => {
      expect(SelectGroup).toBeTypeOf('function');
    });

    it('should export SelectLabel component', () => {
      expect(SelectLabel).toBeTypeOf('function');
    });

    it('should export SelectSeparator component', () => {
      expect(SelectSeparator).toBeTypeOf('function');
    });
  });

  describe('Sub-component Attachment', () => {
    it('should attach Trigger as Select.Trigger', () => {
      expect((Select as any).Trigger).toBe(SelectTrigger);
    });

    it('should attach Value as Select.Value', () => {
      expect((Select as any).Value).toBe(SelectValue);
    });

    it('should attach Icon as Select.Icon', () => {
      expect((Select as any).Icon).toBe(SelectIcon);
    });

    it('should attach Content as Select.Content', () => {
      expect((Select as any).Content).toBe(SelectContent);
    });

    it('should attach Viewport as Select.Viewport', () => {
      expect((Select as any).Viewport).toBe(SelectViewport);
    });

    it('should attach Item as Select.Item', () => {
      expect((Select as any).Item).toBe(SelectItem);
    });

    it('should attach ItemText as Select.ItemText', () => {
      expect((Select as any).ItemText).toBe(SelectItemText);
    });

    it('should attach ItemIndicator as Select.ItemIndicator', () => {
      expect((Select as any).ItemIndicator).toBe(SelectItemIndicator);
    });

    it('should attach Group as Select.Group', () => {
      expect((Select as any).Group).toBe(SelectGroup);
    });

    it('should attach Label as Select.Label', () => {
      expect((Select as any).Label).toBe(SelectLabel);
    });

    it('should attach Separator as Select.Separator', () => {
      expect((Select as any).Separator).toBe(SelectSeparator);
    });
  });

  describe('Component Structure', () => {
    it('should create Select with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({ children: SelectTrigger({ children: 'Select' }) });
        });
      }).not.toThrow();
    });

    it('should accept defaultValue prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({
            defaultValue: 'option1',
            children: SelectContent({
              children: SelectItem({ value: 'option1', children: 'Option 1' }),
            }),
          });
        });
      }).not.toThrow();
    });

    it('should accept defaultOpen prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({
            defaultOpen: true,
            children: SelectContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onValueChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({
            onValueChange: () => {},
            children: SelectTrigger({ children: 'Select' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept disabled prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({
            disabled: true,
            children: SelectContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept required prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({
            required: true,
            children: SelectContent({ children: 'Content' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept name prop for form integration', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({
            name: 'country',
            children: SelectTrigger({ children: 'Select Country' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('SelectTrigger Structure', () => {
    it('should create trigger with children', () => {
      dispose = createRoot(() => {
        const trigger = SelectTrigger({ children: 'Select' });
        expect(trigger).toBeTruthy();
      });
    });

    it('should accept additional props', () => {
      dispose = createRoot(() => {
        const trigger = SelectTrigger({
          children: 'Select',
          className: 'custom',
          'data-test': 'trigger',
        });
        expect(trigger).toBeTruthy();
      });
    });
  });

  describe('SelectValue Structure', () => {
    it('should create value with placeholder', () => {
      dispose = createRoot(() => {
        const value = SelectValue({ placeholder: 'Choose option' });
        expect(value).toBeTruthy();
      });
    });

    it('should accept custom children', () => {
      dispose = createRoot(() => {
        const value = SelectValue({ children: 'Custom value' });
        expect(value).toBeTruthy();
      });
    });
  });

  describe('SelectIcon Structure', () => {
    it('should create icon with children', () => {
      dispose = createRoot(() => {
        const icon = SelectIcon({ children: '▼' });
        expect(icon).toBeTruthy();
      });
    });
  });

  describe('SelectContent Structure', () => {
    it('should create content with children', () => {
      expect(() => {
        dispose = createRoot(() => {
          SelectContent({ children: 'Content' });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          SelectContent({
            children: 'Content',
            className: 'custom',
          });
        });
      }).not.toThrow();
    });

    it('should accept side prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          SelectContent({
            children: 'Content',
            side: 'top',
          });
        });
      }).not.toThrow();
    });

    it('should accept align prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          SelectContent({
            children: 'Content',
            align: 'end',
          });
        });
      }).not.toThrow();
    });
  });

  describe('SelectViewport Structure', () => {
    it('should create viewport with children', () => {
      dispose = createRoot(() => {
        const viewport = SelectViewport({ children: 'Items' });
        expect(viewport).toBeTruthy();
      });
    });
  });

  describe('SelectItem Structure', () => {
    it('should create item with value and children', () => {
      dispose = createRoot(() => {
        const item = SelectItem({ value: 'option1', children: 'Option 1' });
        expect(item).toBeTruthy();
      });
    });

    it('should accept disabled prop', () => {
      dispose = createRoot(() => {
        const item = SelectItem({
          value: 'option1',
          children: 'Option 1',
          disabled: true,
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept textValue prop', () => {
      dispose = createRoot(() => {
        const item = SelectItem({
          value: 'opt1',
          textValue: 'Custom Text',
          children: 'Option 1',
        });
        expect(item).toBeTruthy();
      });
    });
  });

  describe('SelectItemText Structure', () => {
    it('should create item text with children', () => {
      dispose = createRoot(() => {
        const text = SelectItemText({ children: 'Option Text' });
        expect(text).toBeTruthy();
      });
    });
  });

  describe('SelectItemIndicator Structure', () => {
    it('should create item indicator', () => {
      dispose = createRoot(() => {
        const indicator = SelectItemIndicator({ children: '✓' });
        expect(indicator).toBeTruthy();
      });
    });
  });

  describe('SelectGroup Structure', () => {
    it('should create group with children', () => {
      dispose = createRoot(() => {
        const group = SelectGroup({ children: 'Items' });
        expect(group).toBeTruthy();
      });
    });
  });

  describe('SelectLabel Structure', () => {
    it('should create label with children', () => {
      dispose = createRoot(() => {
        const label = SelectLabel({ children: 'Group Label' });
        expect(label).toBeTruthy();
      });
    });
  });

  describe('SelectSeparator Structure', () => {
    it('should create separator', () => {
      dispose = createRoot(() => {
        const separator = SelectSeparator({});
        expect(separator).toBeTruthy();
      });
    });
  });

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      dispose = createRoot(() => {
        const select = Select({
          children: [
            SelectTrigger({
              children: [SelectValue({ placeholder: 'Select option' }), SelectIcon({ children: '▼' })],
            }),
            SelectContent({
              children: SelectViewport({
                children: [
                  SelectItem({
                    value: 'option1',
                    children: [SelectItemText({ children: 'Option 1' }), SelectItemIndicator({ children: '✓' })],
                  }),
                  SelectSeparator({}),
                  SelectGroup({
                    children: [
                      SelectLabel({ children: 'Group' }),
                      SelectItem({ value: 'option2', children: 'Option 2' }),
                    ],
                  }),
                ],
              }),
            }),
          ],
        });

        expect(select).toBeTruthy();
      });
    });

    it('should work with nested structure', () => {
      dispose = createRoot(() => {
        const select = Select({
          defaultValue: 'apple',
          onValueChange: () => {},
          children: [
            SelectTrigger({
              children: SelectValue({ placeholder: 'Choose fruit' }),
              className: 'trigger',
            }),
            SelectContent({
              children: [
                SelectItem({ value: 'apple', children: 'Apple' }),
                SelectItem({ value: 'banana', children: 'Banana', disabled: true }),
                SelectItem({ value: 'orange', children: 'Orange' }),
              ],
              className: 'content',
            }),
          ],
        });

        expect(select).toBeTruthy();
      });
    });
  });

  describe('Type Safety', () => {
    it('should accept children prop on Select', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({ children: SelectTrigger({ children: 'Select' }) });
        });
      }).not.toThrow();
    });

    it('should accept all select props', () => {
      expect(() => {
        dispose = createRoot(() => {
          Select({
            children: SelectContent({ children: 'Content' }),
            defaultValue: 'option1',
            defaultOpen: false,
            disabled: false,
            required: true,
            name: 'field',
            onValueChange: (value: string) => {
              expect(typeof value).toBe('string');
            },
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
      expect(SelectContext).toBeDefined();
      expect(SelectContext.Provider).toBeTypeOf('function');
      expect(SelectContext.defaultValue).toBeDefined();
    });

    it('should provide stable component references', () => {
      const Trigger1 = (Select as any).Trigger;
      const Trigger2 = (Select as any).Trigger;
      expect(Trigger1).toBe(Trigger2);
    });
  });

  describe('Item Registration', () => {
    it('should have item management functions in default context', () => {
      expect(SelectContext.defaultValue.registerItem).toBeTypeOf('function');
      expect(SelectContext.defaultValue.unregisterItem).toBeTypeOf('function');
      expect(SelectContext.defaultValue.items()).toEqual([]);
    });

    it('should have setHighlightedIndex function', () => {
      expect(SelectContext.defaultValue.setHighlightedIndex).toBeTypeOf('function');
      expect(SelectContext.defaultValue.highlightedIndex()).toBe(-1);
    });
  });

  describe('Value Management', () => {
    it('should store item texts in context', () => {
      const itemTexts = SelectContext.defaultValue.itemTexts;
      itemTexts.set('option1', 'Option 1');
      itemTexts.set('option2', 'Option 2');

      expect(itemTexts.get('option1')).toBe('Option 1');
      expect(itemTexts.get('option2')).toBe('Option 2');
    });

    it('should retrieve item text by value', () => {
      const itemTexts = SelectContext.defaultValue.itemTexts;
      itemTexts.set('apple', 'Red Apple');

      expect(itemTexts.get('apple')).toBe('Red Apple');
    });
  });
});
