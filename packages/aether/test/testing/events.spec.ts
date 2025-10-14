/**
 * Fire Event Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '../../src/testing/index.js';

describe('fireEvent', () => {
  let element: HTMLButtonElement;

  beforeEach(() => {
    element = document.createElement('button');
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  describe('click events', () => {
    it('should fire click event', () => {
      const handler = vi.fn();
      element.addEventListener('click', handler);

      fireEvent.click(element);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should fire click with options', () => {
      const handler = vi.fn();
      element.addEventListener('click', handler);

      fireEvent.click(element, { button: 2 });

      expect(handler).toHaveBeenCalled();
    });

    it('should bubble click events', () => {
      const parent = document.createElement('div');
      parent.appendChild(element);
      document.body.appendChild(parent);

      const parentHandler = vi.fn();
      parent.addEventListener('click', parentHandler);

      fireEvent.click(element);

      expect(parentHandler).toHaveBeenCalled();

      parent.remove();
    });
  });

  describe('input events', () => {
    it('should fire input event', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const handler = vi.fn();
      input.addEventListener('input', handler);

      fireEvent.input(input);

      expect(handler).toHaveBeenCalled();

      input.remove();
    });

    it('should fire change event', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const handler = vi.fn();
      input.addEventListener('change', handler);

      fireEvent.change(input);

      expect(handler).toHaveBeenCalled();

      input.remove();
    });
  });

  describe('keyboard events', () => {
    it('should fire keyDown event', () => {
      const handler = vi.fn();
      element.addEventListener('keydown', handler);

      fireEvent.keyDown(element, { key: 'Enter' });

      expect(handler).toHaveBeenCalled();
    });

    it('should fire keyUp event', () => {
      const handler = vi.fn();
      element.addEventListener('keyup', handler);

      fireEvent.keyUp(element, { key: 'a' });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('focus events', () => {
    it('should focus element', () => {
      fireEvent.focus(element);

      expect(document.activeElement).toBe(element);
    });

    it('should blur element', () => {
      element.focus();
      expect(document.activeElement).toBe(element);

      fireEvent.blur(element);

      expect(document.activeElement).not.toBe(element);
    });
  });

  describe('form events', () => {
    it('should fire submit event', () => {
      const form = document.createElement('form');
      document.body.appendChild(form);

      const handler = vi.fn();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        handler();
      });

      fireEvent.submit(form);

      expect(handler).toHaveBeenCalled();

      form.remove();
    });
  });

  describe('event bubbling', () => {
    it('should bubble events by default', () => {
      const parent = document.createElement('div');
      parent.appendChild(element);

      const parentHandler = vi.fn();
      parent.addEventListener('click', parentHandler);

      fireEvent.click(element);

      expect(parentHandler).toHaveBeenCalled();
    });
  });

  describe('event properties', () => {
    it('should pass event properties', () => {
      const handler = vi.fn();
      element.addEventListener('click', handler);

      fireEvent.click(element, {
        ctrlKey: true,
        shiftKey: true,
      });

      expect(handler).toHaveBeenCalled();
      const event = handler.mock.calls[0][0] as MouseEvent;
      expect(event.ctrlKey).toBe(true);
      expect(event.shiftKey).toBe(true);
    });
  });
});
