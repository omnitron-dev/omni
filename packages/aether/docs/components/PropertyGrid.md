# PropertyGrid

A versatile component for editing object properties with different input types, similar to the properties panel in VSCode, browser DevTools, or Figma. The PropertyGrid provides an intuitive interface for viewing and editing structured data with support for various property types, grouping, validation, and search functionality.

## Features

- **Multiple Property Types**: String, number, boolean, select, color, date/time, and custom renderers
- **Grouped Properties**: Organize properties into collapsible sections
- **Search/Filter**: Built-in search functionality to quickly find properties
- **Validation**: Display error messages and required field indicators
- **Disabled/Readonly**: Support for non-editable properties
- **Custom Renderers**: Full control over how properties are displayed and edited
- **Change Tracking**: Callbacks for property value changes
- **Size Variants**: Small, medium, and large size options
- **Type-safe**: Full TypeScript support with comprehensive property descriptors

## Basic Usage

```tsx
import { PropertyGrid } from '@aether/components/forms';
import type { PropertyDescriptor } from '@aether/components/forms';

function App() {
  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      value: 'John Doe',
      required: true,
    },
    {
      key: 'age',
      label: 'Age',
      type: 'number',
      value: 30,
      min: 0,
      max: 120,
    },
    {
      key: 'active',
      label: 'Active',
      type: 'boolean',
      value: true,
    },
  ];

  return (
    <PropertyGrid
      properties={properties}
      onChange={handleChange}
      size="md"
    />
  );
}
```

## API Reference

### PropertyGrid

The main component for displaying and editing properties.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `properties` | `PropertyDescriptor[]` | Required | Array of property descriptors defining what to display |
| `onChange` | `(key: string, value: any) => void` | `undefined` | Callback when a property value changes |
| `searchable` | `boolean` | `false` | Whether to show search/filter input |
| `groups` | `boolean` | `false` | Whether to render grouped properties with collapsible sections |
| `filterFn` | `(property: PropertyDescriptor, searchTerm: string) => boolean` | Default filter | Custom search filter function |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size variant for the property grid |

## Property Types

### PropertyDescriptor

Base interface for all property descriptors.

```typescript
interface BasePropertyDescriptor {
  key: string;              // Unique identifier
  label: string;            // Display label
  type: PropertyType;       // Property type
  value?: any;              // Current value
  disabled?: boolean;       // Whether disabled
  readonly?: boolean;       // Whether readonly
  description?: string;     // Help text
  error?: string;          // Validation error
  required?: boolean;      // Whether required
}
```

### String Properties

```typescript
interface StringPropertyDescriptor extends BasePropertyDescriptor {
  type: 'string';
  value?: string;
  placeholder?: string;
  maxLength?: number;
}
```

**Example:**
```tsx
{
  key: 'username',
  label: 'Username',
  type: 'string',
  value: 'johndoe',
  placeholder: 'Enter username',
  maxLength: 20,
  description: 'Choose a unique username',
  required: true,
}
```

### Number Properties

```typescript
interface NumberPropertyDescriptor extends BasePropertyDescriptor {
  type: 'number';
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}
```

**Example:**
```tsx
{
  key: 'age',
  label: 'Age',
  type: 'number',
  value: 25,
  min: 0,
  max: 120,
  step: 1,
  description: 'Age in years',
}
```

### Boolean Properties

```typescript
interface BooleanPropertyDescriptor extends BasePropertyDescriptor {
  type: 'boolean';
  value?: boolean;
}
```

**Example:**
```tsx
{
  key: 'enabled',
  label: 'Enabled',
  type: 'boolean',
  value: true,
  description: 'Whether the feature is enabled',
}
```

### Select Properties

```typescript
interface SelectPropertyDescriptor extends BasePropertyDescriptor {
  type: 'select';
  value?: string;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
}
```

**Example:**
```tsx
{
  key: 'status',
  label: 'Status',
  type: 'select',
  value: 'active',
  options: [
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Pending', value: 'pending' },
  ],
  placeholder: 'Select status',
}
```

### Color Properties

```typescript
interface ColorPropertyDescriptor extends BasePropertyDescriptor {
  type: 'color';
  value?: string; // Hex color code
}
```

**Example:**
```tsx
{
  key: 'themeColor',
  label: 'Theme Color',
  type: 'color',
  value: '#3b82f6',
  description: 'Primary theme color',
}
```

### Date/Time Properties

```typescript
interface DatePropertyDescriptor extends BasePropertyDescriptor {
  type: 'date' | 'time' | 'datetime';
  value?: string | Date;
  min?: string | Date;
  max?: string | Date;
}
```

**Example:**
```tsx
{
  key: 'startDate',
  label: 'Start Date',
  type: 'date',
  value: '2024-01-01',
  min: '2024-01-01',
  max: '2024-12-31',
}
```

### Group Properties

```typescript
interface GroupPropertyDescriptor extends Omit<BasePropertyDescriptor, 'value'> {
  type: 'group';
  children: PropertyDescriptor[];
  defaultExpanded?: boolean;
}
```

**Example:**
```tsx
{
  key: 'personal',
  label: 'Personal Information',
  type: 'group',
  defaultExpanded: true,
  children: [
    {
      key: 'firstName',
      label: 'First Name',
      type: 'string',
      value: 'John',
    },
    {
      key: 'lastName',
      label: 'Last Name',
      type: 'string',
      value: 'Doe',
    },
  ],
}
```

### Custom Properties

```typescript
interface CustomPropertyDescriptor extends BasePropertyDescriptor {
  type: 'custom';
  render: (props: {
    value: any;
    onChange: (value: any) => void;
    disabled?: boolean;
    readonly?: boolean;
  }) => any;
}
```

**Example:**
```tsx
{
  key: 'tags',
  label: 'Tags',
  type: 'custom',
  value: ['react', 'typescript'],
  render: ({ value, onChange }) => (
    <div>
      {value.map((tag, i) => (
        <span key={i}>{tag}</span>
      ))}
    </div>
  ),
}
```

## Examples

### Grouped Properties with Search

```tsx
<PropertyGrid
  properties={[
    {
      key: 'general',
      label: 'General',
      type: 'group',
      defaultExpanded: true,
      children: [
        { key: 'name', label: 'Name', type: 'string', value: 'My Project' },
        { key: 'version', label: 'Version', type: 'string', value: '1.0.0' },
      ],
    },
    {
      key: 'advanced',
      label: 'Advanced',
      type: 'group',
      defaultExpanded: false,
      children: [
        { key: 'debug', label: 'Debug Mode', type: 'boolean', value: false },
        { key: 'timeout', label: 'Timeout', type: 'number', value: 5000, min: 0 },
      ],
    },
  ]}
  searchable
  groups
  onChange={(key, value) => console.log(key, value)}
/>
```

### With Validation Errors

```tsx
<PropertyGrid
  properties={[
    {
      key: 'email',
      label: 'Email',
      type: 'string',
      value: 'invalid',
      error: 'Please enter a valid email address',
      required: true,
      description: 'We will send confirmation to this email',
    },
    {
      key: 'age',
      label: 'Age',
      type: 'number',
      value: 15,
      min: 18,
      max: 100,
      error: 'You must be at least 18 years old',
      required: true,
    },
  ]}
  onChange={(key, value) => console.log(key, value)}
/>
```

### Disabled and Readonly Properties

```tsx
<PropertyGrid
  properties={[
    {
      key: 'id',
      label: 'ID',
      type: 'string',
      value: 'user-12345',
      readonly: true,
      description: 'System-generated ID (read-only)',
    },
    {
      key: 'createdAt',
      label: 'Created At',
      type: 'date',
      value: '2024-01-01',
      disabled: true,
      description: 'Cannot be modified',
    },
  ]}
  onChange={(key, value) => console.log(key, value)}
/>
```

### Custom Property Renderers

```tsx
<PropertyGrid
  properties={[
    {
      key: 'rating',
      label: 'Rating',
      type: 'custom',
      value: 4,
      render: ({ value, onChange }) => (
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <span
              key={star}
              onClick={() => onChange(star)}
              style={{
                cursor: 'pointer',
                color: star <= value ? '#fbbf24' : '#e5e7eb',
              }}
            >
              ★
            </span>
          ))}
        </div>
      ),
      description: 'Click stars to rate',
    },
  ]}
  onChange={(key, value) => console.log(key, value)}
/>
```

### VSCode-like Settings Panel

```tsx
<PropertyGrid
  properties={[
    {
      key: 'editor',
      label: 'Editor',
      type: 'group',
      defaultExpanded: true,
      children: [
        {
          key: 'editor.fontSize',
          label: 'Font Size',
          type: 'number',
          value: 14,
          min: 8,
          max: 24,
          description: 'Controls the font size in pixels',
        },
        {
          key: 'editor.tabSize',
          label: 'Tab Size',
          type: 'number',
          value: 2,
          min: 1,
          max: 8,
          description: 'The number of spaces a tab is equal to',
        },
        {
          key: 'editor.minimap.enabled',
          label: 'Minimap Enabled',
          type: 'boolean',
          value: true,
          description: 'Controls whether the minimap is shown',
        },
      ],
    },
    {
      key: 'workbench',
      label: 'Workbench',
      type: 'group',
      defaultExpanded: false,
      children: [
        {
          key: 'workbench.colorTheme',
          label: 'Color Theme',
          type: 'select',
          value: 'dark',
          options: [
            { label: 'Dark+ (default dark)', value: 'dark' },
            { label: 'Light+ (default light)', value: 'light' },
          ],
          description: 'Specifies the color theme used in the workbench',
        },
      ],
    },
  ]}
  searchable
  groups
  onChange={(key, value) => console.log(key, value)}
/>
```

### Figma-like Properties Panel

```tsx
<PropertyGrid
  properties={[
    {
      key: 'position',
      label: 'Position',
      type: 'group',
      defaultExpanded: true,
      children: [
        { key: 'x', label: 'X', type: 'number', value: 100 },
        { key: 'y', label: 'Y', type: 'number', value: 100 },
        { key: 'width', label: 'W', type: 'number', value: 200, min: 0 },
        { key: 'height', label: 'H', type: 'number', value: 100, min: 0 },
        { key: 'rotation', label: 'Rotation', type: 'number', value: 0, min: -180, max: 180 },
      ],
    },
    {
      key: 'fill',
      label: 'Fill',
      type: 'group',
      defaultExpanded: true,
      children: [
        { key: 'fillColor', label: 'Color', type: 'color', value: '#3b82f6' },
        { key: 'opacity', label: 'Opacity', type: 'number', value: 100, min: 0, max: 100 },
      ],
    },
  ]}
  groups
  size="sm"
  onChange={(key, value) => console.log(key, value)}
/>
```

## Search Functionality

The PropertyGrid includes built-in search functionality when `searchable` is enabled. By default, it searches through property labels, keys, and descriptions.

### Custom Filter Function

You can provide a custom filter function for more sophisticated filtering:

```tsx
<PropertyGrid
  properties={properties}
  searchable
  filterFn={(property, searchTerm) => {
    // Custom search logic
    const term = searchTerm.toLowerCase();
    return (
      property.label.toLowerCase().includes(term) ||
      property.value?.toString().toLowerCase().includes(term)
    );
  }}
/>
```

## Size Variants

The PropertyGrid supports three size variants:

```tsx
// Small (compact)
<PropertyGrid properties={properties} size="sm" />

// Medium (default)
<PropertyGrid properties={properties} size="md" />

// Large (spacious)
<PropertyGrid properties={properties} size="lg" />
```

## Styling

The PropertyGrid uses Aether's `styled()` function and includes data attributes for custom styling:

```css
/* Custom row styling */
[data-property-row] {
  padding: 0.5rem;
}

[data-property-row]:hover {
  background-color: #f9fafb;
}

/* Custom label styling */
[data-property-label] {
  font-weight: 500;
  color: #374151;
}

/* Custom group header styling */
[data-property-group-header] {
  background-color: #f9fafb;
}

[data-property-group-header]:hover {
  background-color: #f3f4f6;
}
```

## Accessibility

- All input controls use proper ARIA attributes
- Labels are associated with their inputs
- Required fields are marked with `aria-required`
- Error messages are announced to screen readers
- Keyboard navigation is fully supported
- Groups can be expanded/collapsed with Enter/Space keys

## Use Cases

### Object Inspector

Perfect for building object/entity editors where you need to display and edit structured data:

```tsx
const entity = {
  id: 'obj-123',
  name: 'My Object',
  position: { x: 100, y: 200 },
  visible: true,
  color: '#3b82f6',
};
```

### Settings Panel

Ideal for application settings interfaces similar to VSCode:

```tsx
const settings = {
  editor: { fontSize: 14, tabSize: 2 },
  workbench: { colorTheme: 'dark' },
};
```

### Form Builder

Use as a property editor in form builders or no-code tools:

```tsx
const fieldProperties = {
  label: 'Email Address',
  type: 'email',
  required: true,
  validation: 'email',
};
```

### Design Tool Properties

Build properties panels for design tools like Figma or Canva:

```tsx
const layerProperties = {
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  fillColor: '#3b82f6',
  opacity: 100,
};
```

## Performance

- Uses Aether's signal-based reactivity for efficient updates
- Only re-renders affected property rows when values change
- Search/filter is computed reactively without unnecessary re-renders
- Group expand/collapse is handled with minimal DOM updates

## TypeScript Support

The PropertyGrid has full TypeScript support with comprehensive type definitions:

```typescript
import type {
  PropertyDescriptor,
  PropertyGridProps,
  StringPropertyDescriptor,
  NumberPropertyDescriptor,
  BooleanPropertyDescriptor,
  SelectPropertyDescriptor,
  ColorPropertyDescriptor,
  DatePropertyDescriptor,
  GroupPropertyDescriptor,
  CustomPropertyDescriptor,
} from '@aether/components/forms';
```

## Browser Support

Works in all modern browsers that support:
- ES2020+
- CSS Grid
- CSS Flexbox
- Native color picker (for color type)
- Native date/time pickers (for date/time types)

## Related Components

- [Input](/docs/components/Input.md) - Text input component
- [NumberInput](/docs/components/NumberInput.md) - Number input with steppers
- [Select](/docs/components/Select.md) - Select dropdown component
- [Switch](/docs/components/Switch.md) - Boolean toggle switch
- [ColorPicker](/docs/components/ColorPicker.md) - Color selection component
- [DatePicker](/docs/components/DatePicker.md) - Date selection component
- [Collapsible](/docs/components/Collapsible.md) - Collapsible sections (used for groups)
- [Form](/docs/components/Form.md) - Form wrapper component
