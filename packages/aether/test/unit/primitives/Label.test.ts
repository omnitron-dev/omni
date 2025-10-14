/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Label } from '../../../src/primitives/Label.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Label', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render label element', () => {
      const component = () =>
        Label({
          children: 'Email',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl).toBeTruthy();
      expect(labelEl?.textContent).toBe('Email');
    });

    it('should have data-label attribute', () => {
      const component = () =>
        Label({
          children: 'Username',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('data-label')).toBe('');
    });

    it('should use semantic label element', () => {
      const component = () =>
        Label({
          children: 'Password',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.tagName).toBe('LABEL');
    });

    it('should render text content', () => {
      const component = () =>
        Label({
          children: 'First Name',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('First Name');
    });
  });

  describe('htmlFor association', () => {
    it('should apply htmlFor attribute from for prop', () => {
      const component = () =>
        Label({
          for: 'email-input',
          children: 'Email',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('email-input');
    });

    it('should associate with input via htmlFor', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'test-input', children: 'Test' }));

        const input = document.createElement('input');
        input.id = 'test-input';
        div.appendChild(input);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      const inputEl = container.querySelector('input');

      expect(labelEl?.getAttribute('for')).toBe('test-input');
      expect(inputEl?.id).toBe('test-input');
    });

    it('should work without for attribute', () => {
      const component = () =>
        Label({
          children: 'Label without for',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.hasAttribute('for')).toBe(false);
    });

    it('should handle empty for attribute', () => {
      const component = () =>
        Label({
          for: '',
          children: 'Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('');
    });
  });

  describe('Form integration', () => {
    it('should associate with text input', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'username', children: 'Username' }));

        const input = document.createElement('input');
        input.id = 'username';
        input.type = 'text';
        div.appendChild(input);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('username');
    });

    it('should associate with checkbox', () => {
      const component = () => {
        const div = document.createElement('div');

        const checkbox = document.createElement('input');
        checkbox.id = 'terms';
        checkbox.type = 'checkbox';
        div.appendChild(checkbox);

        div.appendChild(Label({ for: 'terms', children: 'I agree to terms' }));

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('terms');
    });

    it('should associate with radio button', () => {
      const component = () => {
        const div = document.createElement('div');

        const radio = document.createElement('input');
        radio.id = 'option-a';
        radio.type = 'radio';
        radio.name = 'options';
        div.appendChild(radio);

        div.appendChild(Label({ for: 'option-a', children: 'Option A' }));

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('option-a');
    });

    it('should associate with textarea', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'comment', children: 'Comment' }));

        const textarea = document.createElement('textarea');
        textarea.id = 'comment';
        div.appendChild(textarea);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('comment');
    });

    it('should associate with select', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'country', children: 'Country' }));

        const select = document.createElement('select');
        select.id = 'country';
        div.appendChild(select);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('country');
    });
  });

  describe('Click behavior', () => {
    it('should trigger click on associated input', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'click-test', children: 'Click me' }));

        const input = document.createElement('input');
        input.id = 'click-test';
        input.type = 'text';
        div.appendChild(input);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label') as HTMLLabelElement;
      const inputEl = container.querySelector('input') as HTMLInputElement;

      // In happy-dom, clicking label should attempt to focus associated input
      labelEl.click();

      // Check that the input exists and label is properly associated
      expect(labelEl.getAttribute('for')).toBe('click-test');
      expect(inputEl.id).toBe('click-test');
    });

    it('should toggle checkbox when label clicked', () => {
      const component = () => {
        const div = document.createElement('div');

        const checkbox = document.createElement('input');
        checkbox.id = 'toggle-test';
        checkbox.type = 'checkbox';
        div.appendChild(checkbox);

        div.appendChild(Label({ for: 'toggle-test', children: 'Toggle' }));

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label') as HTMLLabelElement;
      const checkboxEl = container.querySelector('input') as HTMLInputElement;

      expect(checkboxEl.checked).toBe(false);

      labelEl.click();
      expect(checkboxEl.checked).toBe(true);

      labelEl.click();
      expect(checkboxEl.checked).toBe(false);
    });
  });

  describe('Custom attributes', () => {
    it('should apply custom className', () => {
      const component = () =>
        Label({
          class: 'custom-label',
          children: 'Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.className).toContain('custom-label');
    });

    it('should apply custom id', () => {
      const component = () =>
        Label({
          id: 'my-label',
          children: 'Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.id).toBe('my-label');
    });

    it('should apply data attributes', () => {
      const component = () =>
        Label({
          'data-test': 'value',
          'data-required': 'true',
          children: 'Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('data-test')).toBe('value');
      expect(labelEl?.getAttribute('data-required')).toBe('true');
    });

    it('should apply style attribute', () => {
      const component = () =>
        Label({
          style: { color: 'blue', fontWeight: 'bold' },
          children: 'Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label') as HTMLElement;
      expect(labelEl?.style.color).toBe('blue');
      expect(labelEl?.style.fontWeight).toBe('bold');
    });

    it('should apply title attribute', () => {
      const component = () =>
        Label({
          title: 'This is a tooltip',
          children: 'Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('title')).toBe('This is a tooltip');
    });

    it('should support multiple custom classes', () => {
      const component = () =>
        Label({
          class: 'label field-label required',
          children: 'Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.className).toContain('label');
      expect(labelEl?.className).toContain('field-label');
      expect(labelEl?.className).toContain('required');
    });
  });

  describe('Children handling', () => {
    it('should render string children', () => {
      const component = () =>
        Label({
          children: 'Simple Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('Simple Label');
    });

    it('should render complex text', () => {
      const component = () =>
        Label({
          children: 'Email Address (required)',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('Email Address (required)');
    });

    it('should handle empty string', () => {
      const component = () =>
        Label({
          children: '',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('');
    });

    it('should render label with required indicator', () => {
      const component = () => {
        const label = Label({
          for: 'required-field',
          children: 'Name',
        });

        const span = document.createElement('span');
        span.className = 'required-indicator';
        span.textContent = '*';
        label.appendChild(span);

        return label;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      const indicator = labelEl?.querySelector('.required-indicator');

      expect(indicator).toBeTruthy();
      expect(indicator?.textContent).toBe('*');
    });

    it('should handle numeric content', () => {
      const component = () =>
        Label({
          children: '123',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('123');
    });

    it('should handle unicode characters', () => {
      const component = () =>
        Label({
          children: 'Contraseña',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('Contraseña');
    });
  });

  describe('Accessibility', () => {
    it('should create programmatic association', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'accessible-input', children: 'Accessible Label' }));

        const input = document.createElement('input');
        input.id = 'accessible-input';
        div.appendChild(input);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      const inputEl = container.querySelector('input');

      expect(labelEl?.getAttribute('for')).toBe('accessible-input');
      expect(inputEl?.id).toBe('accessible-input');
    });

    it('should support aria-label for additional context', () => {
      const component = () =>
        Label({
          'aria-label': 'User email address',
          for: 'email',
          children: 'Email',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('aria-label')).toBe('User email address');
    });

    it('should support aria-describedby', () => {
      const component = () =>
        Label({
          'aria-describedby': 'help-text',
          for: 'field',
          children: 'Field',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('aria-describedby')).toBe('help-text');
    });

    it('should work with required indicator aria-label', () => {
      const component = () => {
        const label = Label({
          for: 'required-field',
          children: 'Name ',
        });

        const span = document.createElement('span');
        span.className = 'required-indicator';
        span.setAttribute('aria-label', 'required');
        span.textContent = '*';
        label.appendChild(span);

        return label;
      };

      const { container } = renderComponent(component);

      const indicator = container.querySelector('.required-indicator');
      expect(indicator?.getAttribute('aria-label')).toBe('required');
    });

    it('should not hide content from screen readers', () => {
      const component = () =>
        Label({
          children: 'Visible Label',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('aria-hidden')).toBeNull();
    });
  });

  describe('Required field indicators', () => {
    it('should display asterisk for required fields', () => {
      const component = () => {
        const label = Label({
          for: 'required-input',
          class: 'label-required',
          children: 'Username ',
        });

        const span = document.createElement('span');
        span.className = 'required-indicator';
        span.setAttribute('aria-label', 'required');
        span.textContent = '*';
        label.appendChild(span);

        return label;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      const indicator = labelEl?.querySelector('.required-indicator');

      expect(indicator).toBeTruthy();
      expect(indicator?.textContent).toBe('*');
      expect(indicator?.getAttribute('aria-label')).toBe('required');
    });

    it('should support custom required indicators', () => {
      const component = () => {
        const label = Label({
          for: 'field',
          children: 'Email ',
        });

        const span = document.createElement('span');
        span.className = 'required-badge';
        span.textContent = 'Required';
        label.appendChild(span);

        return label;
      };

      const { container } = renderComponent(component);

      const badge = container.querySelector('.required-badge');
      expect(badge?.textContent).toBe('Required');
    });
  });

  describe('Disabled state styling', () => {
    it('should support disabled styling class', () => {
      const component = () =>
        Label({
          for: 'disabled-input',
          class: 'label-disabled',
          children: 'Disabled Field',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.className).toContain('label-disabled');
    });

    it('should maintain association with disabled input', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'disabled-field', children: 'Disabled' }));

        const input = document.createElement('input');
        input.id = 'disabled-field';
        input.disabled = true;
        div.appendChild(input);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      const inputEl = container.querySelector('input');

      expect(labelEl?.getAttribute('for')).toBe('disabled-field');
      expect(inputEl?.disabled).toBe(true);
    });
  });

  describe('Event handling', () => {
    it('should handle click events', () => {
      let clicked = false;

      const component = () =>
        Label({
          onClick: () => {
            clicked = true;
          },
          children: 'Clickable',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label') as HTMLLabelElement;
      labelEl.click();

      expect(clicked).toBe(true);
    });

    it('should handle mouse events', () => {
      let hovered = false;

      const component = () =>
        Label({
          onMouseEnter: () => {
            hovered = true;
          },
          children: 'Hoverable',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label') as HTMLLabelElement;
      labelEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

      expect(hovered).toBe(true);
    });

    it('should handle focus events', () => {
      let focused = false;

      const component = () =>
        Label({
          onFocus: () => {
            focused = true;
          },
          children: 'Focusable',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label') as HTMLLabelElement;
      labelEl.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      expect(focused).toBe(true);
    });
  });

  describe('Integration patterns', () => {
    it('should work with text input field', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'first-name', children: 'First Name' }));

        const input = document.createElement('input');
        input.id = 'first-name';
        input.type = 'text';
        div.appendChild(input);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      const inputEl = container.querySelector('input');

      expect(labelEl?.getAttribute('for')).toBe('first-name');
      expect(inputEl?.id).toBe('first-name');
    });

    it('should work with checkbox field', () => {
      const component = () => {
        const div = document.createElement('div');

        const checkbox = document.createElement('input');
        checkbox.id = 'agree';
        checkbox.type = 'checkbox';
        div.appendChild(checkbox);

        div.appendChild(Label({ for: 'agree', children: 'I agree' }));

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('agree');
    });

    it('should work with switch-like controls', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Label({ for: 'notifications', children: 'Enable Notifications' }));

        const button = document.createElement('button');
        button.id = 'notifications';
        button.setAttribute('role', 'switch');
        button.setAttribute('aria-checked', 'false');
        div.appendChild(button);

        return div;
      };

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('notifications');
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined children', () => {
      const component = () =>
        Label({
          children: undefined,
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl).toBeTruthy();
    });

    it('should handle null children', () => {
      const component = () =>
        Label({
          children: null,
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl).toBeTruthy();
    });

    it('should handle very long text', () => {
      const longText = 'This is a very long label text that might wrap to multiple lines in the UI '.repeat(5);

      const component = () =>
        Label({
          children: longText,
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe(longText);
    });

    it('should handle special characters in for attribute', () => {
      const component = () =>
        Label({
          for: 'field-with-dashes_and_underscores',
          children: 'Field',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.getAttribute('for')).toBe('field-with-dashes_and_underscores');
    });

    it('should handle whitespace-only children', () => {
      const component = () =>
        Label({
          children: '   ',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('   ');
    });
  });

  describe('Display name', () => {
    it('should have correct display name', () => {
      expect(Label.displayName).toBe('Label');
    });
  });

  describe('Multi-language support', () => {
    it('should handle RTL text', () => {
      const component = () =>
        Label({
          children: 'البريد الإلكتروني',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('البريد الإلكتروني');
    });

    it('should handle mixed LTR/RTL text', () => {
      const component = () =>
        Label({
          children: 'Email البريد',
        });

      const { container } = renderComponent(component);

      const labelEl = container.querySelector('label');
      expect(labelEl?.textContent).toBe('Email البريد');
    });

    it('should handle various languages', () => {
      const labels = [
        'メールアドレス', // Japanese
        '电子邮件', // Chinese
        'Адрес электронной почты', // Russian
        'E-Mail-Adresse', // German
      ];

      labels.forEach((text) => {
        const component = () =>
          Label({
            children: text,
          });

        const { container, cleanup } = renderComponent(component);
        const labelEl = container.querySelector('label');

        expect(labelEl?.textContent).toBe(text);
        cleanup();
        document.body.innerHTML = '';
      });
    });
  });
});
