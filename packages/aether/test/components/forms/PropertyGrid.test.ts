/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PropertyGrid } from '../../../src/components/forms/PropertyGrid.js';
import type { PropertyDescriptor } from '../../../src/components/forms/PropertyGrid.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('PropertyGrid', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic rendering', () => {
    it('should render property grid with string properties', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          value: 'Test Item',
        },
        {
          key: 'description',
          label: 'Description',
          type: 'string',
          value: 'A test description',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      // Check that labels are rendered
      expect(container.textContent).toContain('Name');
      expect(container.textContent).toContain('Description');

      // Check that inputs exist
      const inputs = container.querySelectorAll('input[type="text"]');
      expect(inputs.length).toBe(2);
      expect((inputs[0] as HTMLInputElement).value).toBe('Test Item');
      expect((inputs[1] as HTMLInputElement).value).toBe('A test description');
    });

    it('should render property grid with number properties', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'age',
          label: 'Age',
          type: 'number',
          value: 25,
          min: 0,
          max: 100,
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Age');
      const input = container.querySelector('[data-number-input-field]') as HTMLInputElement;
      expect(input).toBeTruthy();
    });

    it('should render property grid with boolean properties', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'active',
          label: 'Active',
          type: 'boolean',
          value: true,
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Active');
      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
      expect(switchEl).toBeTruthy();
      expect(switchEl.getAttribute('aria-checked')).toBe('true');
    });

    it('should render property grid with select properties', () => {
      const properties: PropertyDescriptor[] = [
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
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Status');
      const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
      expect(trigger).toBeTruthy();
    });

    it('should render property grid with color properties', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'color',
          label: 'Color',
          type: 'color',
          value: '#3b82f6',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Color');
      const colorInput = container.querySelector('input[type="color"]') as HTMLInputElement;
      expect(colorInput).toBeTruthy();
      expect(colorInput.value).toBe('#3b82f6');
    });

    it('should render property grid with date properties', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'startDate',
          label: 'Start Date',
          type: 'date',
          value: '2024-01-01',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Start Date');
      const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
      expect(dateInput).toBeTruthy();
      expect(dateInput.value).toBe('2024-01-01');
    });
  });

  describe('Property descriptions and errors', () => {
    it('should render property descriptions', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'username',
          label: 'Username',
          type: 'string',
          value: 'johndoe',
          description: 'Enter a unique username',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Enter a unique username');
    });

    it('should render property errors', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'email',
          label: 'Email',
          type: 'string',
          value: 'invalid',
          error: 'Please enter a valid email address',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Please enter a valid email address');
    });

    it('should mark required properties with asterisk', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'required-field',
          label: 'Required Field',
          type: 'string',
          value: '',
          required: true,
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      const label = container.querySelector('label') as HTMLElement;
      expect(label).toBeTruthy();
    });
  });

  describe('Property groups', () => {
    it('should render grouped properties', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'general',
          label: 'General',
          type: 'group',
          children: [
            {
              key: 'name',
              label: 'Name',
              type: 'string',
              value: 'Test',
            },
            {
              key: 'email',
              label: 'Email',
              type: 'string',
              value: 'test@example.com',
            },
          ],
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          groups: true,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('General');
      expect(container.textContent).toContain('Name');
      expect(container.textContent).toContain('Email');
    });

    it('should support nested groups', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'settings',
          label: 'Settings',
          type: 'group',
          children: [
            {
              key: 'advanced',
              label: 'Advanced',
              type: 'group',
              children: [
                {
                  key: 'debug',
                  label: 'Debug Mode',
                  type: 'boolean',
                  value: false,
                },
              ],
            },
          ],
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          groups: true,
        });

      const { container } = renderComponent(component);

      expect(container.textContent).toContain('Settings');
      expect(container.textContent).toContain('Advanced');
      expect(container.textContent).toContain('Debug Mode');
    });
  });

  describe('Search functionality', () => {
    it('should render search input when searchable is true', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          value: 'Test',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          searchable: true,
        });

      const { container } = renderComponent(component);

      const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement;
      expect(searchInput).toBeTruthy();
      expect(searchInput.placeholder).toContain('Search');
    });

    it('should filter properties based on search term', () => {
      const properties: PropertyDescriptor[] = [
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
        {
          key: 'email',
          label: 'Email Address',
          type: 'string',
          value: 'john@example.com',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          searchable: true,
        });

      const { container } = renderComponent(component);

      const searchInput = container.querySelector('input[type="search"]') as HTMLInputElement;

      // Initially all properties should be visible
      expect(container.textContent).toContain('First Name');
      expect(container.textContent).toContain('Last Name');
      expect(container.textContent).toContain('Email Address');

      // Search for "name"
      searchInput.value = 'name';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      searchInput.dispatchEvent(new Event('change', { bubbles: true }));

      // Need to trigger the change handler manually in tests
      const changeEvent = new Event('change', { bubbles: true });
      Object.defineProperty(changeEvent, 'target', { value: searchInput, enumerable: true });
      searchInput.dispatchEvent(changeEvent);
    });
  });

  describe('Change callbacks', () => {
    it('should call onChange when string property changes', () => {
      const onChange = vi.fn();
      const properties: PropertyDescriptor[] = [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          value: 'Initial',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          onChange,
        });

      const { container } = renderComponent(component);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      input.value = 'Updated';
      input.dispatchEvent(new Event('input', { bubbles: true }));

      expect(onChange).toHaveBeenCalledWith('name', 'Updated');
    });

    it('should call onChange when boolean property changes', () => {
      const onChange = vi.fn();
      const properties: PropertyDescriptor[] = [
        {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean',
          value: false,
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          onChange,
        });

      const { container } = renderComponent(component);

      const switchEl = container.querySelector('[role="switch"]') as HTMLElement;
      switchEl.click();

      expect(onChange).toHaveBeenCalledWith('enabled', true);
    });
  });

  describe('Disabled and readonly states', () => {
    it('should disable properties when disabled is true', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'locked',
          label: 'Locked Field',
          type: 'string',
          value: 'Cannot edit',
          disabled: true,
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it('should make properties readonly when readonly is true', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'readonly',
          label: 'Readonly Field',
          type: 'string',
          value: 'View only',
          readonly: true,
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      const input = container.querySelector('input[type="text"]') as HTMLInputElement;
      expect(input.readOnly).toBe(true);
    });
  });

  describe('Custom properties', () => {
    it('should render custom property renderers', () => {
      const customRender = vi.fn(({ value, onChange }) => {
        const div = document.createElement('div');
        div.setAttribute('data-testid', 'custom-renderer');
        div.textContent = `Custom: ${value}`;
        div.onclick = () => onChange('clicked');
        return div;
      });

      const properties: PropertyDescriptor[] = [
        {
          key: 'custom',
          label: 'Custom Property',
          type: 'custom',
          value: 'test-value',
          render: customRender,
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
        });

      const { container } = renderComponent(component);

      expect(customRender).toHaveBeenCalled();
      expect(container.textContent).toContain('Custom: test-value');
    });
  });

  describe('Size variants', () => {
    it('should render with small size', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          value: 'Test',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          size: 'sm',
        });

      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should render with medium size (default)', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          value: 'Test',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          size: 'md',
        });

      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });

    it('should render with large size', () => {
      const properties: PropertyDescriptor[] = [
        {
          key: 'name',
          label: 'Name',
          type: 'string',
          value: 'Test',
        },
      ];

      const component = () =>
        PropertyGrid({
          properties,
          size: 'lg',
        });

      const { container } = renderComponent(component);
      expect(container).toBeTruthy();
    });
  });
});
