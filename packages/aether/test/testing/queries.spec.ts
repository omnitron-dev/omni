/**
 * Query Utilities Tests
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '../../src/testing/index.js';

describe('queries', () => {
  afterEach(() => {
    cleanup();
  });

  describe('getByText', () => {
    it('should find element by text', () => {
      const { getByText } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Hello World';
        return div as any;
      });

      const element = getByText('Hello World');
      expect(element).toBeTruthy();
    });

    it('should throw if element not found', () => {
      const { getByText } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() => getByText('Not Found')).toThrow();
    });

    it('should match partial text', () => {
      const { getByText } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Hello World';
        return div as any;
      });

      const element = getByText('Hello');
      expect(element).toBeTruthy();
    });

    it('should match with RegExp', () => {
      const { getByText } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Hello World';
        return div as any;
      });

      const element = getByText(/hello/i);
      expect(element).toBeTruthy();
    });
  });

  describe('getByRole', () => {
    it('should find element by role', () => {
      const { getByRole } = render(() => {
        const button = document.createElement('button');
        button.setAttribute('role', 'button');
        button.textContent = 'Click';
        return button as any;
      });

      const element = getByRole('button');
      expect(element).toBeTruthy();
    });

    it('should throw if role not found', () => {
      const { getByRole } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() => getByRole('button')).toThrow();
    });
  });

  describe('getByLabelText', () => {
    it('should find input by label text', () => {
      const { getByLabelText } = render(() => {
        const container = document.createElement('div');
        const label = document.createElement('label');
        label.textContent = 'Username';
        label.setAttribute('for', 'username');
        const input = document.createElement('input');
        input.id = 'username';
        container.appendChild(label);
        container.appendChild(input);
        return container as any;
      });

      const element = getByLabelText('Username');
      expect(element).toBeTruthy();
      expect(element.id).toBe('username');
    });

    it('should throw if label not found', () => {
      const { getByLabelText } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() => getByLabelText('Not Found')).toThrow();
    });
  });

  describe('getByTestId', () => {
    it('should find element by test id', () => {
      const { getByTestId } = render(() => {
        const div = document.createElement('div');
        div.setAttribute('data-testid', 'my-element');
        return div as any;
      });

      const element = getByTestId('my-element');
      expect(element).toBeTruthy();
    });

    it('should throw if test id not found', () => {
      const { getByTestId } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() => getByTestId('not-found')).toThrow();
    });
  });

  describe('queryBy* variants', () => {
    it('should return null if not found', () => {
      const { queryByText } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      const element = queryByText('Not Found');
      expect(element).toBeNull();
    });

    it('should return element if found', () => {
      const { queryByText } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Found';
        return div as any;
      });

      const element = queryByText('Found');
      expect(element).toBeTruthy();
    });
  });

  describe('findBy* variants', () => {
    it('should return promise that resolves', async () => {
      const { findByText } = render(() => {
        const div = document.createElement('div');
        div.textContent = 'Async Found';
        return div as any;
      });

      const element = await findByText('Async Found');
      expect(element).toBeTruthy();
    });

    it('should reject promise if not found', async () => {
      const { findByText } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      await expect(findByText('Not Found')).rejects.toThrow();
    });
  });

  describe('error messages', () => {
    it('should provide helpful error messages', () => {
      const { getByText } = render(() => {
        const div = document.createElement('div');
        return div as any;
      });

      expect(() => getByText('Missing')).toThrow(/Unable to find element/);
    });
  });
});
