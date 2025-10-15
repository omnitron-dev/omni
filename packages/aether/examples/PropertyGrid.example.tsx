/**
 * PropertyGrid Component Examples
 *
 * Demonstrates various use cases for the PropertyGrid component:
 * - Basic property editing with different types
 * - Grouped properties
 * - Searchable property grid
 * - Validation and errors
 * - Custom property renderers
 * - Real-world examples (object editor, settings panel, form builder)
 */

import { PropertyGrid } from '../src/components/forms/PropertyGrid.js';
import type { PropertyDescriptor } from '../src/components/forms/PropertyGrid.js';
import { Box } from '../src/components/layout/Box.js';
import { signal } from '../src/core/reactivity/signal.js';

// ============================================================================
// Example 1: Basic Property Types
// ============================================================================

export function BasicPropertyTypes() {
  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      value: 'John Doe',
      placeholder: 'Enter name',
      description: 'Full name of the person',
      required: true,
    },
    {
      key: 'age',
      label: 'Age',
      type: 'number',
      value: 30,
      min: 0,
      max: 120,
      description: 'Age in years',
    },
    {
      key: 'active',
      label: 'Active',
      type: 'boolean',
      value: true,
      description: 'Whether the account is active',
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      value: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Inactive', value: 'inactive' },
        { label: 'Pending', value: 'pending' },
        { label: 'Suspended', value: 'suspended' },
      ],
      description: 'Account status',
    },
    {
      key: 'favoriteColor',
      label: 'Favorite Color',
      type: 'color',
      value: '#3b82f6',
      description: 'Pick your favorite color',
    },
    {
      key: 'birthDate',
      label: 'Birth Date',
      type: 'date',
      value: '1990-01-01',
      description: 'Date of birth',
    },
  ];

  return (
    <Box padding="lg">
      <h2>Basic Property Types</h2>
      <PropertyGrid properties={properties} onChange={handleChange} size="md" />
    </Box>
  );
}

// ============================================================================
// Example 2: Grouped Properties
// ============================================================================

export function GroupedProperties() {
  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
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
          required: true,
        },
        {
          key: 'lastName',
          label: 'Last Name',
          type: 'string',
          value: 'Doe',
          required: true,
        },
        {
          key: 'email',
          label: 'Email',
          type: 'string',
          value: 'john.doe@example.com',
          required: true,
        },
      ],
    },
    {
      key: 'address',
      label: 'Address',
      type: 'group',
      defaultExpanded: false,
      children: [
        {
          key: 'street',
          label: 'Street',
          type: 'string',
          value: '123 Main St',
        },
        {
          key: 'city',
          label: 'City',
          type: 'string',
          value: 'New York',
        },
        {
          key: 'zipCode',
          label: 'Zip Code',
          type: 'string',
          value: '10001',
        },
        {
          key: 'country',
          label: 'Country',
          type: 'select',
          value: 'us',
          options: [
            { label: 'United States', value: 'us' },
            { label: 'Canada', value: 'ca' },
            { label: 'United Kingdom', value: 'uk' },
            { label: 'Germany', value: 'de' },
          ],
        },
      ],
    },
    {
      key: 'preferences',
      label: 'Preferences',
      type: 'group',
      defaultExpanded: true,
      children: [
        {
          key: 'newsletter',
          label: 'Subscribe to Newsletter',
          type: 'boolean',
          value: true,
        },
        {
          key: 'notifications',
          label: 'Enable Notifications',
          type: 'boolean',
          value: false,
        },
        {
          key: 'theme',
          label: 'Theme',
          type: 'select',
          value: 'light',
          options: [
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
            { label: 'Auto', value: 'auto' },
          ],
        },
      ],
    },
  ];

  return (
    <Box padding="lg">
      <h2>Grouped Properties</h2>
      <PropertyGrid properties={properties} onChange={handleChange} groups size="md" />
    </Box>
  );
}

// ============================================================================
// Example 3: Searchable Property Grid
// ============================================================================

export function SearchablePropertyGrid() {
  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
    { key: 'width', label: 'Width', type: 'number', value: 800, min: 0, max: 2000 },
    { key: 'height', label: 'Height', type: 'number', value: 600, min: 0, max: 2000 },
    { key: 'x', label: 'X Position', type: 'number', value: 0 },
    { key: 'y', label: 'Y Position', type: 'number', value: 0 },
    { key: 'rotation', label: 'Rotation', type: 'number', value: 0, min: 0, max: 360 },
    { key: 'opacity', label: 'Opacity', type: 'number', value: 100, min: 0, max: 100 },
    { key: 'visible', label: 'Visible', type: 'boolean', value: true },
    { key: 'locked', label: 'Locked', type: 'boolean', value: false },
    { key: 'fillColor', label: 'Fill Color', type: 'color', value: '#3b82f6' },
    { key: 'strokeColor', label: 'Stroke Color', type: 'color', value: '#000000' },
    { key: 'strokeWidth', label: 'Stroke Width', type: 'number', value: 2, min: 0, max: 50 },
    { key: 'blendMode', label: 'Blend Mode', type: 'select', value: 'normal', options: [
      { label: 'Normal', value: 'normal' },
      { label: 'Multiply', value: 'multiply' },
      { label: 'Screen', value: 'screen' },
      { label: 'Overlay', value: 'overlay' },
    ]},
  ];

  return (
    <Box padding="lg">
      <h2>Searchable Property Grid (Design Tool Properties)</h2>
      <PropertyGrid properties={properties} onChange={handleChange} searchable size="md" />
    </Box>
  );
}

// ============================================================================
// Example 4: With Validation and Errors
// ============================================================================

export function WithValidationAndErrors() {
  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
    {
      key: 'username',
      label: 'Username',
      type: 'string',
      value: 'ab',
      error: 'Username must be at least 3 characters',
      required: true,
      description: 'Choose a unique username (min 3 characters)',
    },
    {
      key: 'email',
      label: 'Email',
      type: 'string',
      value: 'invalid-email',
      error: 'Please enter a valid email address',
      required: true,
      description: 'We will send confirmation to this email',
    },
    {
      key: 'password',
      label: 'Password',
      type: 'string',
      value: '123',
      error: 'Password must be at least 8 characters and contain numbers',
      required: true,
      description: 'Use a strong password',
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
  ];

  return (
    <Box padding="lg">
      <h2>With Validation Errors</h2>
      <PropertyGrid properties={properties} onChange={handleChange} size="md" />
    </Box>
  );
}

// ============================================================================
// Example 5: Disabled and Readonly Properties
// ============================================================================

export function DisabledAndReadonly() {
  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
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
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      value: 'John Doe',
      description: 'You can edit this',
    },
    {
      key: 'locked',
      label: 'Account Locked',
      type: 'boolean',
      value: true,
      disabled: true,
      description: 'Only admins can change this',
    },
  ];

  return (
    <Box padding="lg">
      <h2>Disabled and Readonly Properties</h2>
      <PropertyGrid properties={properties} onChange={handleChange} size="md" />
    </Box>
  );
}

// ============================================================================
// Example 6: Custom Property Renderers
// ============================================================================

export function CustomPropertyRenderers() {
  const tags = signal(['react', 'typescript', 'aether']);

  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
    {
      key: 'name',
      label: 'Name',
      type: 'string',
      value: 'My Project',
    },
    {
      key: 'tags',
      label: 'Tags',
      type: 'custom',
      value: tags(),
      render: ({ value, onChange }) => {
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {value.map((tag: string, index: number) => (
              <span
                key={index}
                style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#eff6ff',
                  color: '#1e40af',
                  borderRadius: '0.25rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const newTags = value.filter((_: string, i: number) => i !== index);
                  onChange(newTags);
                }}
              >
                {tag} ×
              </span>
            ))}
            <button
              style={{
                padding: '0.25rem 0.5rem',
                backgroundColor: '#dbeafe',
                border: '1px dashed #3b82f6',
                color: '#3b82f6',
                borderRadius: '0.25rem',
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
              onClick={() => {
                const newTag = prompt('Enter tag name');
                if (newTag) {
                  onChange([...value, newTag]);
                }
              }}
            >
              + Add
            </button>
          </div>
        );
      },
      description: 'Click on a tag to remove it',
    },
    {
      key: 'rating',
      label: 'Rating',
      type: 'custom',
      value: 4,
      render: ({ value, onChange }) => {
        return (
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {[1, 2, 3, 4, 5].map((star) => (
              <span
                key={star}
                style={{
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: star <= value ? '#fbbf24' : '#e5e7eb',
                }}
                onClick={() => onChange(star)}
              >
                ★
              </span>
            ))}
          </div>
        );
      },
      description: 'Click stars to rate',
    },
  ];

  return (
    <Box padding="lg">
      <h2>Custom Property Renderers</h2>
      <PropertyGrid properties={properties} onChange={handleChange} size="md" />
    </Box>
  );
}

// ============================================================================
// Example 7: VSCode-like Settings Panel
// ============================================================================

export function VSCodeLikeSettings() {
  const handleChange = (key: string, value: any) => {
    console.log(`Setting ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
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
          key: 'editor.fontFamily',
          label: 'Font Family',
          type: 'string',
          value: 'Consolas, Monaco, monospace',
          description: 'Controls the font family',
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
          key: 'editor.wordWrap',
          label: 'Word Wrap',
          type: 'select',
          value: 'off',
          options: [
            { label: 'Off', value: 'off' },
            { label: 'On', value: 'on' },
            { label: 'Word Wrap Column', value: 'wordWrapColumn' },
            { label: 'Bounded', value: 'bounded' },
          ],
          description: 'Controls how lines should wrap',
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
      key: 'files',
      label: 'Files',
      type: 'group',
      defaultExpanded: false,
      children: [
        {
          key: 'files.autoSave',
          label: 'Auto Save',
          type: 'select',
          value: 'afterDelay',
          options: [
            { label: 'Off', value: 'off' },
            { label: 'After Delay', value: 'afterDelay' },
            { label: 'On Focus Change', value: 'onFocusChange' },
            { label: 'On Window Change', value: 'onWindowChange' },
          ],
          description: 'Controls auto save of dirty files',
        },
        {
          key: 'files.autoSaveDelay',
          label: 'Auto Save Delay',
          type: 'number',
          value: 1000,
          min: 0,
          max: 10000,
          description: 'Controls the delay in ms after which a dirty file is saved automatically',
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
            { label: 'Monokai', value: 'monokai' },
            { label: 'Solarized Dark', value: 'solarized-dark' },
          ],
          description: 'Specifies the color theme used in the workbench',
        },
        {
          key: 'workbench.iconTheme',
          label: 'Icon Theme',
          type: 'select',
          value: 'vs-seti',
          options: [
            { label: 'Seti (Visual Studio Code)', value: 'vs-seti' },
            { label: 'None', value: 'null' },
            { label: 'Minimal', value: 'vs-minimal' },
          ],
          description: 'Specifies the icon theme used in the workbench',
        },
      ],
    },
  ];

  return (
    <Box padding="lg" style={{ maxWidth: '800px' }}>
      <h2>VSCode-like Settings Panel</h2>
      <PropertyGrid properties={properties} onChange={handleChange} searchable groups size="md" />
    </Box>
  );
}

// ============================================================================
// Example 8: Figma-like Properties Panel
// ============================================================================

export function FigmaLikeProperties() {
  const handleChange = (key: string, value: any) => {
    console.log(`Property ${key} changed to:`, value);
  };

  const properties: PropertyDescriptor[] = [
    {
      key: 'layer',
      label: 'Layer',
      type: 'group',
      defaultExpanded: true,
      children: [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          value: 'Rectangle 1',
        },
        {
          key: 'visible',
          label: 'Visible',
          type: 'boolean',
          value: true,
        },
        {
          key: 'locked',
          label: 'Locked',
          type: 'boolean',
          value: false,
        },
      ],
    },
    {
      key: 'position',
      label: 'Position',
      type: 'group',
      defaultExpanded: true,
      children: [
        {
          key: 'x',
          label: 'X',
          type: 'number',
          value: 100,
        },
        {
          key: 'y',
          label: 'Y',
          type: 'number',
          value: 100,
        },
        {
          key: 'width',
          label: 'W',
          type: 'number',
          value: 200,
          min: 0,
        },
        {
          key: 'height',
          label: 'H',
          type: 'number',
          value: 100,
          min: 0,
        },
        {
          key: 'rotation',
          label: 'Rotation',
          type: 'number',
          value: 0,
          min: -180,
          max: 180,
        },
      ],
    },
    {
      key: 'fill',
      label: 'Fill',
      type: 'group',
      defaultExpanded: true,
      children: [
        {
          key: 'fillColor',
          label: 'Color',
          type: 'color',
          value: '#3b82f6',
        },
        {
          key: 'opacity',
          label: 'Opacity',
          type: 'number',
          value: 100,
          min: 0,
          max: 100,
        },
      ],
    },
    {
      key: 'stroke',
      label: 'Stroke',
      type: 'group',
      defaultExpanded: false,
      children: [
        {
          key: 'strokeColor',
          label: 'Color',
          type: 'color',
          value: '#000000',
        },
        {
          key: 'strokeWidth',
          label: 'Width',
          type: 'number',
          value: 2,
          min: 0,
          max: 100,
        },
      ],
    },
    {
      key: 'effects',
      label: 'Effects',
      type: 'group',
      defaultExpanded: false,
      children: [
        {
          key: 'shadow',
          label: 'Drop Shadow',
          type: 'boolean',
          value: false,
        },
        {
          key: 'blur',
          label: 'Blur',
          type: 'number',
          value: 0,
          min: 0,
          max: 100,
        },
      ],
    },
  ];

  return (
    <Box padding="lg" style={{ maxWidth: '300px' }}>
      <h2>Figma-like Properties Panel</h2>
      <PropertyGrid properties={properties} onChange={handleChange} groups size="sm" />
    </Box>
  );
}
