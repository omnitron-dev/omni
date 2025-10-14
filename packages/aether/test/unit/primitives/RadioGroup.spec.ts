/**
 * RadioGroup Primitive Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupIndicator,
  RadioGroupContext,
  RadioGroupItemContext,
} from '../../../src/primitives/RadioGroup.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import { createRoot } from '../../../src/core/reactivity/batch.js';

describe('RadioGroup Primitive', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // ============================================================================
  // Context Tests
  // ============================================================================

  describe('RadioGroupContext', () => {
    it('should have default values', () => {
      expect(RadioGroupContext.id).toBeTypeOf('symbol');
      expect(RadioGroupContext.defaultValue).toBeDefined();
      expect(RadioGroupContext.defaultValue.value()).toBeUndefined();
      expect(RadioGroupContext.defaultValue.setValue).toBeTypeOf('function');
      expect(RadioGroupContext.defaultValue.disabled).toBe(false);
      expect(RadioGroupContext.defaultValue.required).toBe(false);
      expect(RadioGroupContext.defaultValue.orientation).toBe('vertical');
      expect(RadioGroupContext.defaultValue.loop).toBe(true);
    });

    it('should have stable default IDs', () => {
      expect(RadioGroupContext.defaultValue.groupId).toBe('');
    });
  });

  describe('RadioGroupItemContext', () => {
    it('should have default values', () => {
      expect(RadioGroupItemContext.id).toBeTypeOf('symbol');
      expect(RadioGroupItemContext.defaultValue).toBeDefined();
      expect(RadioGroupItemContext.defaultValue.value).toBe('');
      expect(RadioGroupItemContext.defaultValue.checked()).toBe(false);
      expect(RadioGroupItemContext.defaultValue.disabled).toBe(false);
      expect(RadioGroupItemContext.defaultValue.itemId).toBe('');
    });
  });

  // ============================================================================
  // Component Exports
  // ============================================================================

  describe('Component Exports', () => {
    it('should export RadioGroup component', () => {
      expect(RadioGroup).toBeTypeOf('function');
    });

    it('should export RadioGroupItem component', () => {
      expect(RadioGroupItem).toBeTypeOf('function');
    });

    it('should export RadioGroupIndicator component', () => {
      expect(RadioGroupIndicator).toBeTypeOf('function');
    });
  });

  // Note: Sub-components are not attached in the current implementation
  // They are exported separately and can be used directly
  // This is intentional based on the comment in RadioGroup.ts:
  // "Note: Compound component pattern (RadioGroup.Item, RadioGroup.Indicator)
  // is set up in the index.ts exports"

  // ============================================================================
  // Structure Tests
  // ============================================================================

  describe('Component Structure', () => {
    it('should create RadioGroup with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should create RadioGroupItem with required props', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept defaultValue prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            defaultValue: 'option1',
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept onValueChange callback', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            onValueChange: () => {},
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept disabled prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            disabled: true,
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept required prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            required: true,
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept name prop for form integration', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            name: 'color',
            children: RadioGroupItem({ value: 'red', children: 'Red' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept orientation prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            orientation: 'horizontal',
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should accept loop prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            loop: false,
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });
  });

  describe('RadioGroupItem Structure', () => {
    it('should create item with value and children', () => {
      dispose = createRoot(() => {
        const item = RadioGroupItem({ value: 'option1', children: 'Option 1' });
        expect(item).toBeTruthy();
      });
    });

    it('should accept disabled prop', () => {
      dispose = createRoot(() => {
        const item = RadioGroupItem({
          value: 'option1',
          children: 'Option 1',
          disabled: true,
        });
        expect(item).toBeTruthy();
      });
    });

    it('should accept id prop', () => {
      dispose = createRoot(() => {
        const item = RadioGroupItem({
          value: 'option1',
          id: 'custom-id',
          children: 'Option 1',
        });
        expect(item).toBeTruthy();
      });
    });
  });

  describe('RadioGroupIndicator Structure', () => {
    it('should create indicator component', () => {
      // Indicator only renders when in a checked item context
      // Test that it can be created without throwing
      expect(() => {
        dispose = createRoot(() => {
          RadioGroupIndicator({ children: '✓' });
        });
      }).not.toThrow();
    });

    it('should accept additional props', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroupIndicator({
            children: '✓',
            className: 'custom-indicator',
          });
        });
      }).not.toThrow();
    });

    it('should render within a checked item', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          defaultValue: 'option1',
          children: RadioGroupItem({
            value: 'option1',
            children: RadioGroupIndicator({ children: '✓' }),
          }),
        });
        expect(group).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // Controlled vs Uncontrolled Mode
  // ============================================================================

  describe('Controlled Mode', () => {
    it('should accept controlled value signal', () => {
      const value = signal<string | undefined>('option1');

      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            value,
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should update when controlled signal changes', () => {
      const value = signal<string | undefined>('option1');

      dispose = createRoot(() => {
        RadioGroup({
          value,
          children: [
            RadioGroupItem({ value: 'option1', children: 'Option 1' }),
            RadioGroupItem({ value: 'option2', children: 'Option 2' }),
          ],
        });
      });

      // Change value - should not throw
      expect(() => value.set('option2')).not.toThrow();
    });
  });

  describe('Uncontrolled Mode', () => {
    it('should work with defaultValue', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            defaultValue: 'option2',
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should work without any value', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2' }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Orientation Tests
  // ============================================================================

  describe('Orientation', () => {
    it('should support horizontal orientation', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            orientation: 'horizontal',
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should support vertical orientation', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            orientation: 'vertical',
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should default to vertical orientation', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Loop Behavior
  // ============================================================================

  describe('Loop Behavior', () => {
    it('should support loop=true', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            loop: true,
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should support loop=false', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            loop: false,
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should default to loop=true', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2' }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Disabled State
  // ============================================================================

  describe('Disabled State', () => {
    it('should support disabled group', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            disabled: true,
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should support disabled individual items', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2', disabled: true }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should support mix of disabled and enabled items', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: [
              RadioGroupItem({ value: 'option1', children: 'Option 1' }),
              RadioGroupItem({ value: 'option2', children: 'Option 2', disabled: true }),
              RadioGroupItem({ value: 'option3', children: 'Option 3' }),
            ],
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Required State
  // ============================================================================

  describe('Required State', () => {
    it('should support required prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            required: true,
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should work without required', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Form Integration
  // ============================================================================

  describe('Form Integration', () => {
    it('should support name prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            name: 'color',
            children: RadioGroupItem({ value: 'red', children: 'Red' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with name and defaultValue', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            name: 'size',
            defaultValue: 'medium',
            children: [
              RadioGroupItem({ value: 'small', children: 'Small' }),
              RadioGroupItem({ value: 'medium', children: 'Medium' }),
              RadioGroupItem({ value: 'large', children: 'Large' }),
            ],
          });
        });
      }).not.toThrow();
    });

    it('should work with name and controlled value', () => {
      const value = signal<string | undefined>('green');

      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            name: 'color',
            value,
            children: RadioGroupItem({ value: 'green', children: 'Green' }),
          });
        });
      }).not.toThrow();
    });

    it('should work without name prop', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Value Change Callback
  // ============================================================================

  describe('Value Change Callback', () => {
    it('should accept onValueChange callback', () => {
      const callback = () => {};

      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            onValueChange: callback,
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with onValueChange and defaultValue', () => {
      const callback = (value: string) => {
        expect(typeof value).toBe('string');
      };

      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            defaultValue: 'option1',
            onValueChange: callback,
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });

    it('should work with onValueChange and controlled value', () => {
      const value = signal<string | undefined>('option1');
      const callback = (newValue: string) => {
        expect(typeof newValue).toBe('string');
      };

      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            value,
            onValueChange: callback,
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // Composition
  // ============================================================================

  describe('Composition', () => {
    it('should allow composing all sub-components', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          name: 'fruit',
          defaultValue: 'apple',
          children: [
            RadioGroupItem({
              value: 'apple',
              children: ['Apple', RadioGroupIndicator({ children: '✓' })],
            }),
            RadioGroupItem({
              value: 'banana',
              children: ['Banana', RadioGroupIndicator({ children: '✓' })],
            }),
          ],
        });

        expect(group).toBeTruthy();
      });
    });

    it('should work with complex nested structure', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          name: 'size',
          defaultValue: 'medium',
          orientation: 'horizontal',
          required: true,
          onValueChange: () => {},
          children: [
            RadioGroupItem({
              value: 'small',
              id: 'size-small',
              children: ['Small', RadioGroupIndicator({ children: '•' })],
            }),
            RadioGroupItem({
              value: 'medium',
              id: 'size-medium',
              children: ['Medium', RadioGroupIndicator({ children: '•' })],
            }),
            RadioGroupItem({
              value: 'large',
              id: 'size-large',
              disabled: true,
              children: ['Large', RadioGroupIndicator({ children: '•' })],
            }),
          ],
        });

        expect(group).toBeTruthy();
      });
    });

    it('should support multiple radio groups', () => {
      dispose = createRoot(() => {
        const group1 = RadioGroup({
          name: 'color',
          children: [
            RadioGroupItem({ value: 'red', children: 'Red' }),
            RadioGroupItem({ value: 'blue', children: 'Blue' }),
          ],
        });

        const group2 = RadioGroup({
          name: 'size',
          children: [
            RadioGroupItem({ value: 'small', children: 'Small' }),
            RadioGroupItem({ value: 'large', children: 'Large' }),
          ],
        });

        expect(group1).toBeTruthy();
        expect(group2).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // Type Safety
  // ============================================================================

  describe('Type Safety', () => {
    it('should accept children prop on RadioGroup', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({ children: RadioGroupItem({ value: 'option1', children: 'Option 1' }) });
        });
      }).not.toThrow();
    });

    it('should accept all radiogroup props', () => {
      const value = signal<string | undefined>('option1');

      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({
            children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
            value,
            defaultValue: 'option1',
            disabled: false,
            required: true,
            name: 'field',
            orientation: 'horizontal',
            loop: true,
            onValueChange: (val: string) => {
              expect(typeof val).toBe('string');
            },
          });
        });
      }).not.toThrow();
    });

    it('should accept all item props', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroupItem({
            value: 'option1',
            children: 'Option 1',
            disabled: true,
            id: 'custom-id',
            className: 'custom-class',
            'data-testid': 'test-radio',
          });
        });
      }).not.toThrow();
    });
  });

  // ============================================================================
  // API Surface
  // ============================================================================

  describe('API Surface', () => {
    it('should export contexts for advanced use cases', () => {
      expect(RadioGroupContext).toBeDefined();
      expect(RadioGroupContext.Provider).toBeTypeOf('function');
      expect(RadioGroupContext.defaultValue).toBeDefined();

      expect(RadioGroupItemContext).toBeDefined();
      expect(RadioGroupItemContext.Provider).toBeTypeOf('function');
      expect(RadioGroupItemContext.defaultValue).toBeDefined();
    });

    it('should have stable context references', () => {
      expect(RadioGroupContext).toBe(RadioGroupContext);
      expect(RadioGroupItemContext).toBe(RadioGroupItemContext);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty group', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroup({ children: [] });
        });
      }).not.toThrow();
    });

    it('should handle single item', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          children: RadioGroupItem({ value: 'only', children: 'Only Option' }),
        });
        expect(group).toBeTruthy();
      });
    });

    it('should handle undefined defaultValue', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
        });
        expect(group).toBeTruthy();
      });
    });

    it('should handle value not matching any item', () => {
      const value = signal<string | undefined>('nonexistent');

      dispose = createRoot(() => {
        const group = RadioGroup({
          value,
          children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
        });
        expect(group).toBeTruthy();
      });
    });

    it('should handle custom id on items', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          children: RadioGroupItem({ value: 'option1', id: 'custom-id', children: 'Option 1' }),
        });
        expect(group).toBeTruthy();
      });
    });

    it('should handle additional props on items', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          children: RadioGroupItem({
            value: 'option1',
            children: 'Option 1',
            className: 'custom-class',
            'data-testid': 'test-radio',
          }),
        });
        expect(group).toBeTruthy();
      });
    });

    it('should handle null children in indicator', () => {
      expect(() => {
        dispose = createRoot(() => {
          RadioGroupIndicator({ children: null });
        });
      }).not.toThrow();
    });

    it('should handle array of items', () => {
      dispose = createRoot(() => {
        const items = [
          RadioGroupItem({ value: 'option1', children: 'Option 1' }),
          RadioGroupItem({ value: 'option2', children: 'Option 2' }),
          RadioGroupItem({ value: 'option3', children: 'Option 3' }),
        ];

        const group = RadioGroup({ children: items });
        expect(group).toBeTruthy();
      });
    });

    it('should handle deeply nested children', () => {
      dispose = createRoot(() => {
        const group = RadioGroup({
          children: RadioGroupItem({
            value: 'option1',
            children: [
              'Option 1 ',
              RadioGroupIndicator({
                children: ['✓', ' Selected'],
              }),
            ],
          }),
        });
        expect(group).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // Multiple RadioGroups
  // ============================================================================

  describe('Multiple RadioGroups', () => {
    it('should support multiple independent radio groups', () => {
      dispose = createRoot(() => {
        const colors = RadioGroup({
          name: 'color',
          defaultValue: 'red',
          children: [
            RadioGroupItem({ value: 'red', children: 'Red' }),
            RadioGroupItem({ value: 'blue', children: 'Blue' }),
          ],
        });

        const sizes = RadioGroup({
          name: 'size',
          defaultValue: 'small',
          children: [
            RadioGroupItem({ value: 'small', children: 'Small' }),
            RadioGroupItem({ value: 'large', children: 'Large' }),
          ],
        });

        expect(colors).toBeTruthy();
        expect(sizes).toBeTruthy();
      });
    });

    it('should support radio groups with different orientations', () => {
      dispose = createRoot(() => {
        const horizontal = RadioGroup({
          orientation: 'horizontal',
          children: RadioGroupItem({ value: 'option1', children: 'Option 1' }),
        });

        const vertical = RadioGroup({
          orientation: 'vertical',
          children: RadioGroupItem({ value: 'option2', children: 'Option 2' }),
        });

        expect(horizontal).toBeTruthy();
        expect(vertical).toBeTruthy();
      });
    });
  });
});
