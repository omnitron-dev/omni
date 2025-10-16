/**
 * PropertyGrid Component
 *
 * A versatile component for editing object properties with different input types.
 * Inspired by property panels in VSCode, browser DevTools, and Figma.
 *
 * Features:
 * - Multiple property types (string, number, boolean, select, color, date, array, object)
 * - Grouped properties with expandable sections
 * - Search/filter properties
 * - Validation with error messages
 * - Disabled/readonly properties
 * - Custom property renderers
 * - Change tracking
 */

import { defineComponent } from '../../core/component/define.js';
import { createContext, useContext, provideContext } from '../../core/component/context.js';
import type { WritableSignal } from '../../core/reactivity/types.js';
import { signal, computed } from '../../core/reactivity/index.js';
import { jsx } from '../../jsx-runtime.js';
import { styled } from '../../styling/styled.js';
import { Input } from './Input.js';
import {
  NumberInput as NumberInputPrimitive,
  NumberInputField,
  NumberInputIncrement,
  NumberInputDecrement,
} from '../../primitives/NumberInput.js';
import { Switch as SwitchPrimitive, SwitchThumb } from '../../primitives/Switch.js';
import {
  Select as SelectPrimitive,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectViewport,
  SelectItem,
} from '../../primitives/Select.js';

// ============================================================================
// Types
// ============================================================================

export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'select'
  | 'color'
  | 'date'
  | 'time'
  | 'datetime'
  | 'array'
  | 'object'
  | 'group'
  | 'custom';

export interface BasePropertyDescriptor {
  /** Unique key for the property */
  key: string;

  /** Display label for the property */
  label: string;

  /** Property type */
  type: PropertyType;

  /** Current value */
  value?: any;

  /** Whether the property is disabled */
  disabled?: boolean;

  /** Whether the property is readonly */
  readonly?: boolean;

  /** Description or help text */
  description?: string;

  /** Validation error message */
  error?: string;

  /** Whether the property is required */
  required?: boolean;
}

export interface StringPropertyDescriptor extends BasePropertyDescriptor {
  type: 'string';
  value?: string;
  placeholder?: string;
  maxLength?: number;
}

export interface NumberPropertyDescriptor extends BasePropertyDescriptor {
  type: 'number';
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

export interface BooleanPropertyDescriptor extends BasePropertyDescriptor {
  type: 'boolean';
  value?: boolean;
}

export interface SelectPropertyDescriptor extends BasePropertyDescriptor {
  type: 'select';
  value?: string;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
}

export interface ColorPropertyDescriptor extends BasePropertyDescriptor {
  type: 'color';
  value?: string;
}

export interface DatePropertyDescriptor extends BasePropertyDescriptor {
  type: 'date' | 'time' | 'datetime';
  value?: string | Date;
  min?: string | Date;
  max?: string | Date;
}

export interface ArrayPropertyDescriptor extends BasePropertyDescriptor {
  type: 'array';
  value?: any[];
  itemType?: PropertyType;
  maxItems?: number;
}

export interface ObjectPropertyDescriptor extends BasePropertyDescriptor {
  type: 'object';
  value?: Record<string, any>;
  properties?: PropertyDescriptor[];
}

export interface GroupPropertyDescriptor extends Omit<BasePropertyDescriptor, 'value'> {
  type: 'group';
  children: PropertyDescriptor[];
  defaultExpanded?: boolean;
}

export interface CustomPropertyDescriptor extends BasePropertyDescriptor {
  type: 'custom';
  render: (props: {
    value: any;
    onChange: (value: any) => void;
    disabled?: boolean;
    readonly?: boolean;
  }) => any;
}

export type PropertyDescriptor =
  | StringPropertyDescriptor
  | NumberPropertyDescriptor
  | BooleanPropertyDescriptor
  | SelectPropertyDescriptor
  | ColorPropertyDescriptor
  | DatePropertyDescriptor
  | ArrayPropertyDescriptor
  | ObjectPropertyDescriptor
  | GroupPropertyDescriptor
  | CustomPropertyDescriptor;

export interface PropertyGridProps {
  /** Array of property descriptors */
  properties: PropertyDescriptor[];

  /** Callback when a property value changes */
  onChange?: (key: string, value: any) => void;

  /** Whether to show search/filter input */
  searchable?: boolean;

  /** Whether to show properties in groups */
  groups?: boolean;

  /** Custom search filter function */
  filterFn?: (property: PropertyDescriptor, searchTerm: string) => boolean;

  /** Size variant */
  size?: 'sm' | 'md' | 'lg';

  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface PropertyGridContextValue {
  onChange: (key: string, value: any) => void;
  size: 'sm' | 'md' | 'lg';
}

const PropertyGridContext = createContext<PropertyGridContextValue | null>(null);

const usePropertyGridContext = (): PropertyGridContextValue => {
  const context = useContext(PropertyGridContext);
  if (!context) {
    throw new Error('PropertyGrid sub-components must be used within a PropertyGrid component');
  }
  return context;
};

// ============================================================================
// Styled Components
// ============================================================================

const PropertyGridContainer = styled('div', {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    width: '100%',
  },
});

const PropertyGridSearch = styled('div', {
  base: {
    marginBottom: '0.75rem',
  },
});

const PropertyGridList = styled('div', {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
});

const PropertyRow = styled('div', {
  base: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem',
    alignItems: 'start',
    padding: '0.5rem',
    borderRadius: '0.25rem',
    transition: 'background-color 0.15s',
    '&:hover': {
      backgroundColor: '#f9fafb',
    },
  },
  variants: {
    size: {
      sm: {
        gap: '0.5rem',
        padding: '0.375rem',
        fontSize: '0.875rem',
      },
      md: {
        gap: '0.75rem',
        padding: '0.5rem',
        fontSize: '1rem',
      },
      lg: {
        gap: '1rem',
        padding: '0.625rem',
        fontSize: '1.125rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

const PropertyLabel = styled('label', {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontWeight: '500',
    color: '#374151',
    fontSize: '0.875rem',
    paddingTop: '0.5rem',
  },
  variants: {
    required: {
      true: {
        '&::after': {
          content: '" *"',
          color: '#ef4444',
        },
      },
    },
    disabled: {
      true: {
        color: '#9ca3af',
        cursor: 'not-allowed',
      },
    },
  },
});

const PropertyDescription = styled('div', {
  base: {
    fontSize: '0.75rem',
    color: '#6b7280',
    lineHeight: '1.25',
  },
});

const PropertyError = styled('div', {
  base: {
    fontSize: '0.75rem',
    color: '#ef4444',
    marginTop: '0.25rem',
  },
});

const PropertyValue = styled('div', {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
});

const PropertyGroupContainer = styled('div', {
  base: {
    border: '1px solid #e5e7eb',
    borderRadius: '0.375rem',
    overflow: 'hidden',
  },
});

const PropertyGroupHeader = styled('button', {
  base: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem 1rem',
    backgroundColor: '#f9fafb',
    border: 'none',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&::after': {
      content: '"▼"',
      fontSize: '0.625rem',
      transition: 'transform 0.2s',
    },
    '&[data-state="open"]::after': {
      transform: 'rotate(180deg)',
    },
  },
});

const PropertyGroupContent = styled('div', {
  base: {
    padding: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Default filter function for properties
 */
function defaultFilterFn(property: PropertyDescriptor, searchTerm: string): boolean {
  const term = searchTerm.toLowerCase();
  return (
    property.label.toLowerCase().includes(term) ||
    property.key.toLowerCase().includes(term) ||
    (property.description?.toLowerCase().includes(term) ?? false)
  );
}

/**
 * Flatten properties to include nested properties from groups and objects
 */
function flattenProperties(properties: PropertyDescriptor[]): PropertyDescriptor[] {
  const result: PropertyDescriptor[] = [];

  for (const prop of properties) {
    if (prop.type === 'group') {
      result.push(...flattenProperties(prop.children));
    } else if (prop.type === 'object' && prop.properties) {
      result.push(prop);
      result.push(...flattenProperties(prop.properties));
    } else {
      result.push(prop);
    }
  }

  return result;
}

// ============================================================================
// Property Renderers
// ============================================================================

const StringPropertyRenderer = defineComponent<{
  property: StringPropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const ctx = usePropertyGridContext();

  return () => {
    const property = props.property;
    return jsx(Input, {
      type: 'text',
      value: property.value || '',
      onChange: (value: string) => {
        ctx.onChange(property.key, value);
      },
      placeholder: property.placeholder,
      disabled: property.disabled,
      readonly: property.readonly,
      maxLength: property.maxLength,
      size: ctx.size,
      status: property.error ? 'error' : undefined,
    });
  };
});

const NumberPropertyRenderer = defineComponent<{
  property: NumberPropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const ctx = usePropertyGridContext();
  const valueSignal: WritableSignal<number> = signal(props.property.value ?? 0);

  return () => {
    const property = props.property;
    return jsx(NumberInputPrimitive, {
      value: valueSignal,
      onValueChange: (value: number) => {
        valueSignal.set(value);
        ctx.onChange(property.key, value);
      },
      min: property.min,
      max: property.max,
      step: property.step,
      disabled: property.disabled,
      readonly: property.readonly,
      size: ctx.size,
      children: [
        jsx(NumberInputField, { placeholder: property.placeholder }),
        jsx(NumberInputIncrement, { children: '▲' }),
        jsx(NumberInputDecrement, { children: '▼' }),
      ],
    });
  };
});

const BooleanPropertyRenderer = defineComponent<{
  property: BooleanPropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const ctx = usePropertyGridContext();
  const checkedSignal: WritableSignal<boolean> = signal(props.property.value ?? false);

  return () => {
    const property = props.property;
    return jsx(SwitchPrimitive, {
      checked: checkedSignal,
      onCheckedChange: (checked: boolean) => {
        checkedSignal.set(checked);
        ctx.onChange(property.key, checked);
      },
      disabled: property.disabled,
      size: ctx.size,
      children: jsx(SwitchThumb, {}),
    });
  };
});

const SelectPropertyRenderer = defineComponent<{
  property: SelectPropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const ctx = usePropertyGridContext();
  const valueSignal: WritableSignal<string> = signal(props.property.value || '');

  return () => {
    const property = props.property;
    return jsx(SelectPrimitive, {
      value: valueSignal,
      onValueChange: (value: string) => {
        valueSignal.set(value);
        ctx.onChange(property.key, value);
      },
      disabled: property.disabled,
      children: [
        jsx(SelectTrigger, {
          size: ctx.size,
          children: [
            jsx(SelectValue, { placeholder: property.placeholder || 'Select...' }),
            jsx(SelectIcon, { children: '▼' }),
          ],
        }),
        jsx(SelectContent, {
          children: jsx(SelectViewport, {
            children: property.options.map((option) =>
              jsx(SelectItem, { key: option.value, value: option.value, children: option.label })
            ),
          }),
        }),
      ],
    });
  };
});

const ColorPropertyRenderer = defineComponent<{
  property: ColorPropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const ctx = usePropertyGridContext();

  return () => {
    const property = props.property;
    return jsx('input', {
      type: 'color',
      value: property.value || '#000000',
      onChange: (e: Event) => {
        const target = e.target as HTMLInputElement;
        ctx.onChange(property.key, target.value);
      },
      disabled: property.disabled,
      style: {
        width: '100%',
        height: ctx.size === 'sm' ? '2rem' : ctx.size === 'lg' ? '2.5rem' : '2.25rem',
        border: '1px solid #e5e7eb',
        borderRadius: '0.375rem',
        cursor: property.disabled ? 'not-allowed' : 'pointer',
      },
    });
  };
});

const DatePropertyRenderer = defineComponent<{
  property: DatePropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const ctx = usePropertyGridContext();

  return () => {
    const property = props.property;
    const inputType = property.type === 'time' ? 'time' : property.type === 'datetime' ? 'datetime-local' : 'date';

    let value = '';
    if (property.value) {
      if (property.value instanceof Date) {
        if (inputType === 'date') {
          value = property.value.toISOString().split('T')[0] || '';
        } else if (inputType === 'time') {
          const timeString = property.value.toTimeString().split(' ')[0];
          value = timeString ? timeString.substring(0, 5) : '';
        } else {
          value = property.value.toISOString().slice(0, 16);
        }
      } else {
        value = property.value;
      }
    }

    return jsx('input', {
      type: inputType,
      value,
      onChange: (e: Event) => {
        const target = e.target as HTMLInputElement;
        ctx.onChange(property.key, target.value);
      },
      disabled: property.disabled,
      style: {
        width: '100%',
        padding: ctx.size === 'sm' ? '0.375rem 0.75rem' : ctx.size === 'lg' ? '0.625rem 1.25rem' : '0.5rem 1rem',
        borderRadius: '0.375rem',
        border: '1px solid #e5e7eb',
        fontSize: ctx.size === 'sm' ? '0.875rem' : ctx.size === 'lg' ? '1.125rem' : '1rem',
      },
    });
  };
});

const CustomPropertyRenderer = defineComponent<{
  property: CustomPropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const ctx = usePropertyGridContext();

  return () => {
    const property = props.property;
    return property.render({
      value: property.value,
      onChange: (value: any) => ctx.onChange(property.key, value),
      disabled: property.disabled,
      readonly: property.readonly,
    });
  };
});

// ============================================================================
// Property Row Component
// ============================================================================

const PropertyRowComponent = defineComponent<{
  property: PropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => () => {
  const property = props.property;

  // Don't render group properties (they are rendered separately)
  if (property.type === 'group') {
    return null;
  }

  let renderer: any = null;

  switch (property.type) {
    case 'string':
      renderer = jsx(StringPropertyRenderer, { property: property as StringPropertyDescriptor, size: props.size });
      break;
    case 'number':
      renderer = jsx(NumberPropertyRenderer, { property: property as NumberPropertyDescriptor, size: props.size });
      break;
    case 'boolean':
      renderer = jsx(BooleanPropertyRenderer, { property: property as BooleanPropertyDescriptor, size: props.size });
      break;
    case 'select':
      renderer = jsx(SelectPropertyRenderer, { property: property as SelectPropertyDescriptor, size: props.size });
      break;
    case 'color':
      renderer = jsx(ColorPropertyRenderer, { property: property as ColorPropertyDescriptor, size: props.size });
      break;
    case 'date':
    case 'time':
    case 'datetime':
      renderer = jsx(DatePropertyRenderer, { property: property as DatePropertyDescriptor, size: props.size });
      break;
    case 'custom':
      renderer = jsx(CustomPropertyRenderer, { property: property as CustomPropertyDescriptor, size: props.size });
      break;
    case 'array':
    case 'object':
    default:
      // Simple text representation for now
      renderer = jsx('div', {
        style: { fontSize: '0.875rem', color: '#6b7280' },
        children: `${property.type} (not implemented)`,
      });
      break;
  }

  return jsx(PropertyRow, {
    size: props.size,
    children: [
      jsx(PropertyLabel, {
        required: property.required,
        disabled: property.disabled,
        children: [
          jsx('span', { children: property.label }),
          property.description && jsx(PropertyDescription, { children: property.description }),
        ],
      }),
      jsx(PropertyValue, {
        children: [renderer, property.error && jsx(PropertyError, { children: property.error })],
      }),
    ],
  });
});

// ============================================================================
// Property Group Component
// ============================================================================

const PropertyGroupComponent = defineComponent<{
  group: GroupPropertyDescriptor;
  size?: 'sm' | 'md' | 'lg';
}>((props) => {
  const isOpen = signal(props.group.defaultExpanded ?? true);

  return () => {
    const group = props.group;

    return jsx(PropertyGroupContainer, {
      children: [
        jsx(PropertyGroupHeader, {
          'data-state': isOpen() ? 'open' : 'closed',
          onClick: () => isOpen.set(!isOpen()),
          children: group.label,
        }),
        isOpen() &&
          jsx(PropertyGroupContent, {
            children: group.children.map((child) =>
              child.type === 'group'
                ? jsx(PropertyGroupComponent, { key: child.key, group: child, size: props.size })
                : jsx(PropertyRowComponent, { key: child.key, property: child, size: props.size })
            ),
          }),
      ],
    });
  };
});

// ============================================================================
// Main PropertyGrid Component
// ============================================================================

export const PropertyGrid = defineComponent<PropertyGridProps>((props) => {
  const searchTerm = signal('');
  const size = props.size || 'md';

  const contextValue: PropertyGridContextValue = {
    onChange: (key: string, value: any) => {
      props.onChange?.(key, value);
    },
    size,
  };

  provideContext(PropertyGridContext, contextValue);

  return () => {
    const filterFn = props.filterFn || defaultFilterFn;
    const properties = props.properties || [];

    // Filter properties based on search term
    const filteredProperties = computed(() => {
      const term = searchTerm();
      if (!term) return properties;

      // For groups, filter children
      return properties
        .map((prop) => {
          if (prop.type === 'group') {
            const filteredChildren = flattenProperties(prop.children).filter((child) => filterFn(child, term));
            if (filteredChildren.length === 0) return null;
            return { ...prop, children: filteredChildren };
          }
          return filterFn(prop, term) ? prop : null;
        })
        .filter((p) => p !== null) as PropertyDescriptor[];
    });

    const { properties: _, onChange: __, filterFn: ___, size: ____, ...restProps } = props;

    return jsx(PropertyGridContainer, {
      ...restProps,
      children: [
        // Search input
        props.searchable &&
          jsx(PropertyGridSearch, {
            children: jsx(Input, {
              type: 'search',
              placeholder: 'Search properties...',
              value: searchTerm(),
              onChange: (value: string) => {
                searchTerm.set(value);
              },
              size,
            }),
          }),

        // Property list
        jsx(PropertyGridList, {
          children: filteredProperties().map((property) =>
            property.type === 'group'
              ? jsx(PropertyGroupComponent, { key: property.key, group: property, size })
              : jsx(PropertyRowComponent, { key: property.key, property, size })
          ),
        }),
      ],
    });
  };
});

// Display name
PropertyGrid.displayName = 'PropertyGrid';
