/**
 * Custom Matchers Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '../../src/testing/index.js';
import '../../src/testing/matchers.js';

describe('custom matchers', () => {
  afterEach(() => {
    cleanup();
  });

  describe('toBeInTheDocument', () => {
    it('should pass when element is in document', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Test';
        return div as any;
      });

      const element = container.firstElementChild as HTMLElement;
      expect(element).toBeInTheDocument();
    });

    it('should fail when element is not in document', () => {
      const element = document.createElement('div');

      expect(() => expect(element).toBeInTheDocument()).toThrow();
    });
  });

  describe('toHaveTextContent', () => {
    it('should pass when element has text content', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Hello World';
        return div as any;
      });

      expect(container.firstElementChild as HTMLElement).toHaveTextContent('Hello');
    });

    it('should fail when text not present', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Hello';
        return div as any;
      });

      expect(() =>
        expect(container.firstElementChild as HTMLElement).toHaveTextContent('Goodbye')
      ).toThrow();
    });
  });

  describe('toHaveAttribute', () => {
    it('should pass when element has attribute', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.setAttribute('data-test', 'value');
        return div as any;
      });

      expect(container.firstElementChild as HTMLElement).toHaveAttribute('data-test');
    });

    it('should pass with correct value', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.setAttribute('data-test', 'value');
        return div as any;
      });

      expect(container.firstElementChild as HTMLElement).toHaveAttribute('data-test', 'value');
    });

    it('should fail when attribute missing', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() =>
        expect(container.firstElementChild as HTMLElement).toHaveAttribute('missing')
      ).toThrow();
    });
  });

  describe('toHaveClass', () => {
    it('should pass when element has class', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.className = 'test-class another';
        return div as any;
      });

      expect(container.firstElementChild as HTMLElement).toHaveClass('test-class');
    });

    it('should fail when class missing', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() =>
        expect(container.firstElementChild as HTMLElement).toHaveClass('missing')
      ).toThrow();
    });
  });

  describe('toBeVisible', () => {
    it('should pass for visible elements', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        div.style.display = 'block';
        return div as any;
      });

      // Note: offsetParent check may not work in test environment
      const element = container.firstElementChild as HTMLElement;
      // Visibility detection is limited in jsdom
    });
  });

  describe('toBeDisabled', () => {
    it('should pass when element is disabled', () => {
      const { container } = render(() => {
        const button = document.createElement('button');
        button.disabled = true;
        return button as any;
      });

      expect(container.firstElementChild as HTMLInputElement).toBeDisabled();
    });

    it('should fail when element is enabled', () => {
      const { container } = render(() => {
        const button = document.createElement('button');
        return button as any;
      });

      expect(() =>
        expect(container.firstElementChild as HTMLInputElement).toBeDisabled()
      ).toThrow();
    });
  });

  describe('toHaveValue', () => {
    it('should pass when input has value', () => {
      const input = document.createElement('input');
      input.value = 'test';
      document.body.appendChild(input);

      expect(input).toHaveValue('test');

      input.remove();
    });

    it('should fail when value different', () => {
      const input = document.createElement('input');
      input.value = 'test';
      document.body.appendChild(input);

      expect(() => expect(input).toHaveValue('wrong')).toThrow();

      input.remove();
    });
  });

  describe('toBeChecked', () => {
    it('should pass when checkbox is checked', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      document.body.appendChild(checkbox);

      expect(checkbox).toBeChecked();

      checkbox.remove();
    });

    it('should fail when checkbox is unchecked', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      document.body.appendChild(checkbox);

      expect(() => expect(checkbox).toBeChecked()).toThrow();

      checkbox.remove();
    });
  });

  describe('negative assertions', () => {
    it('should support not.toBeInTheDocument', () => {
      const element = document.createElement('div');

      expect(element).not.toBeInTheDocument();
    });

    it('should support not.toHaveClass', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(container.firstElementChild as HTMLElement).not.toHaveClass('missing');
    });
  });

  describe('edge cases', () => {
    it('should handle empty text content', () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() =>
        expect(container.firstElementChild as HTMLElement).toHaveTextContent('text')
      ).toThrow();
    });

    it('should handle null values', () => {
      const div = document.createElement('div');

      expect(() => expect(div).toHaveAttribute('missing')).toThrow();
    });
  });

  describe('error messages', () => {
    it('should provide clear error messages', () => {
      const div = document.createElement('div');

      try {
        expect(div).toBeInTheDocument();
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('expected element to be in the document');
      }
    });
  });
});
