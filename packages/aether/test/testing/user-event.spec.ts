/**
 * User Event Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, userEvent, cleanup } from '../../src/testing/index.js';

describe('userEvent', () => {
  afterEach(() => {
    cleanup();
  });

  describe('typing text', () => {
    it('should type text into input', async () => {
      const { getByRole } = render(() => {
        const input = document.createElement('input');
        input.setAttribute('role', 'textbox');
        return input as any;
      });

      const input = getByRole('textbox') as HTMLInputElement;

      await userEvent.type(input, 'Hello World');

      expect(input.value).toBe('Hello World');
    });

    it('should type with delay', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const start = Date.now();
      await userEvent.type(input, 'ab', { delay: 100 });
      const duration = Date.now() - start;

      expect(input.value).toBe('ab');
      expect(duration).toBeGreaterThan(150);

      input.remove();
    });

    it('should trigger input events', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const handler = vi.fn();
      input.addEventListener('input', handler);

      await userEvent.type(input, 'test');

      expect(handler).toHaveBeenCalledTimes(4); // Once per character

      input.remove();
    });
  });

  describe('clicking elements', () => {
    it('should click element', async () => {
      const button = document.createElement('button');
      document.body.appendChild(button);

      const handler = vi.fn();
      button.addEventListener('click', handler);

      await userEvent.click(button);

      expect(handler).toHaveBeenCalled();

      button.remove();
    });

    it('should double click', async () => {
      const button = document.createElement('button');
      document.body.appendChild(button);

      const handler = vi.fn();
      button.addEventListener('click', handler);

      await userEvent.dblClick(button);

      expect(handler).toHaveBeenCalledTimes(2);

      button.remove();
    });
  });

  describe('selecting options', () => {
    it('should select single option', async () => {
      const select = document.createElement('select');
      const option1 = document.createElement('option');
      option1.value = 'a';
      const option2 = document.createElement('option');
      option2.value = 'b';
      select.appendChild(option1);
      select.appendChild(option2);
      document.body.appendChild(select);

      await userEvent.selectOptions(select, 'b');

      expect(option2.selected).toBe(true);

      select.remove();
    });

    it('should select multiple options', async () => {
      const select = document.createElement('select');
      select.multiple = true;
      const option1 = document.createElement('option');
      option1.value = 'a';
      const option2 = document.createElement('option');
      option2.value = 'b';
      select.appendChild(option1);
      select.appendChild(option2);
      document.body.appendChild(select);

      await userEvent.selectOptions(select, ['a', 'b']);

      expect(option1.selected).toBe(true);
      expect(option2.selected).toBe(true);

      select.remove();
    });
  });

  describe('file uploads', () => {
    it('should upload single file', async () => {
      const input = document.createElement('input');
      input.type = 'file';
      document.body.appendChild(input);

      const file = new File(['content'], 'test.txt', { type: 'text/plain' });

      await userEvent.upload(input, file);

      expect(input.files).toHaveLength(1);
      expect(input.files?.[0]).toBe(file);

      input.remove();
    });

    it('should upload multiple files', async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      document.body.appendChild(input);

      const files = [
        new File(['a'], 'a.txt'),
        new File(['b'], 'b.txt'),
      ];

      await userEvent.upload(input, files);

      expect(input.files).toHaveLength(2);

      input.remove();
    });
  });

  describe('clearing input', () => {
    it('should clear input value', async () => {
      const input = document.createElement('input');
      input.value = 'initial';
      document.body.appendChild(input);

      await userEvent.clear(input);

      expect(input.value).toBe('');

      input.remove();
    });

    it('should trigger input event on clear', async () => {
      const input = document.createElement('input');
      input.value = 'initial';
      document.body.appendChild(input);

      const handler = vi.fn();
      input.addEventListener('input', handler);

      await userEvent.clear(input);

      expect(handler).toHaveBeenCalled();

      input.remove();
    });
  });

  describe('hover interactions', () => {
    it('should trigger hover event', async () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const handler = vi.fn();
      div.addEventListener('mouseenter', handler);

      await userEvent.hover(div);

      expect(handler).toHaveBeenCalled();

      div.remove();
    });

    it('should trigger unhover event', async () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const handler = vi.fn();
      div.addEventListener('mouseleave', handler);

      await userEvent.unhover(div);

      expect(handler).toHaveBeenCalled();

      div.remove();
    });
  });

  describe('realistic event sequences', () => {
    it('should simulate complete form interaction', async () => {
      const form = document.createElement('form');
      const input = document.createElement('input');
      input.name = 'username';
      const button = document.createElement('button');
      button.type = 'submit';
      form.appendChild(input);
      form.appendChild(button);
      document.body.appendChild(form);

      const submitHandler = vi.fn((e) => e.preventDefault());
      form.addEventListener('submit', submitHandler);

      await userEvent.type(input, 'john');
      await userEvent.click(button);

      expect(input.value).toBe('john');
      expect(submitHandler).toHaveBeenCalled();

      form.remove();
    });
  });
});
