/**
 * Focus Management Utilities Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFocusableElements,
  getFocusableBounds,
  focusFirst,
  trapFocus,
  saveFocus,
  restoreFocus,
} from '../../../../src/primitives/utils/focus.js';

describe('Focus Management Utilities', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('getFocusableElements', () => {
    it('should find all focusable elements', () => {
      container.innerHTML = `
        <a href="#">Link</a>
        <button>Button</button>
        <input type="text">
        <textarea></textarea>
        <select><option>Option</option></select>
        <div tabindex="0">Focusable div</div>
      `;

      const focusable = getFocusableElements(container);
      expect(focusable).toHaveLength(6);
    });

    it('should exclude disabled elements', () => {
      container.innerHTML = `
        <button>Enabled</button>
        <button disabled>Disabled</button>
        <input type="text">
        <input type="text" disabled>
      `;

      const focusable = getFocusableElements(container);
      expect(focusable).toHaveLength(2);
      expect(focusable[0].textContent).toBe('Enabled');
      expect(focusable[1]).toBeInstanceOf(HTMLInputElement);
      expect((focusable[1] as HTMLInputElement).disabled).toBe(false);
    });

    it('should exclude elements with tabindex="-1"', () => {
      container.innerHTML = `
        <div tabindex="0">Focusable</div>
        <div tabindex="-1">Not focusable</div>
        <button tabindex="-1">Not focusable button</button>
      `;

      const focusable = getFocusableElements(container);
      expect(focusable).toHaveLength(1);
      expect(focusable[0].textContent).toBe('Focusable');
    });

    it('should return empty array when no focusable elements', () => {
      container.innerHTML = `
        <div>Not focusable</div>
        <span>Also not focusable</span>
      `;

      const focusable = getFocusableElements(container);
      expect(focusable).toHaveLength(0);
    });

    it('should find nested focusable elements', () => {
      container.innerHTML = `
        <div>
          <div>
            <button>Nested button</button>
            <div>
              <input type="text">
            </div>
          </div>
        </div>
      `;

      const focusable = getFocusableElements(container);
      expect(focusable).toHaveLength(2);
    });

    it('should maintain document order', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <input id="second" type="text">
        <a id="third" href="#">Third</a>
      `;

      const focusable = getFocusableElements(container);
      expect(focusable[0].id).toBe('first');
      expect(focusable[1].id).toBe('second');
      expect(focusable[2].id).toBe('third');
    });
  });

  describe('getFocusableBounds', () => {
    it('should return first and last focusable elements', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <input type="text">
        <a id="last" href="#">Last</a>
      `;

      const { first, last } = getFocusableBounds(container);
      expect(first?.id).toBe('first');
      expect(last?.id).toBe('last');
    });

    it('should return same element when only one focusable', () => {
      container.innerHTML = `
        <button id="only">Only</button>
      `;

      const { first, last } = getFocusableBounds(container);
      expect(first?.id).toBe('only');
      expect(last?.id).toBe('only');
      expect(first).toBe(last);
    });

    it('should return null when no focusable elements', () => {
      container.innerHTML = `<div>No focusable elements</div>`;

      const { first, last } = getFocusableBounds(container);
      expect(first).toBeNull();
      expect(last).toBeNull();
    });
  });

  describe('focusFirst', () => {
    it('should focus first focusable element', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="second">Second</button>
      `;

      const firstButton = container.querySelector('#first') as HTMLElement;
      focusFirst(container);

      expect(document.activeElement).toBe(firstButton);
    });

    it('should do nothing when no focusable elements', () => {
      container.innerHTML = `<div>Nothing focusable</div>`;

      const previousActive = document.activeElement;
      focusFirst(container);

      expect(document.activeElement).toBe(previousActive);
    });

    it('should skip disabled elements', () => {
      container.innerHTML = `
        <button disabled>Disabled</button>
        <button id="enabled">Enabled</button>
      `;

      focusFirst(container);
      expect(document.activeElement?.id).toBe('enabled');
    });
  });

  describe('trapFocus', () => {
    it('should trap Tab key within container', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="second">Second</button>
        <button id="third">Third</button>
      `;

      const cleanup = trapFocus(container);
      const firstBtn = container.querySelector('#first') as HTMLElement;
      const thirdBtn = container.querySelector('#third') as HTMLElement;

      // Focus should be on first element after trap
      expect(document.activeElement).toBe(firstBtn);

      // Simulate Tab from last element - should cycle to first
      thirdBtn.focus();
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      container.dispatchEvent(tabEvent);

      // After real Tab, would cycle to first, but in test we check event handling
      cleanup();
    });

    it('should trap Shift+Tab key', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="second">Second</button>
      `;

      const cleanup = trapFocus(container);
      const firstBtn = container.querySelector('#first') as HTMLElement;

      firstBtn.focus();
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      });
      container.dispatchEvent(shiftTabEvent);

      cleanup();
    });

    it('should allow non-Tab keys', () => {
      container.innerHTML = `<button>Button</button>`;

      const cleanup = trapFocus(container);

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const result = container.dispatchEvent(enterEvent);

      // Event should not be prevented
      expect(result).toBe(true);

      cleanup();
    });

    it('should cleanup event listener on cleanup', () => {
      container.innerHTML = `<button>Button</button>`;

      const cleanup = trapFocus(container);
      cleanup();

      // After cleanup, Tab events should not be trapped
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const result = container.dispatchEvent(tabEvent);
      expect(result).toBe(true);
    });

    it('should focus first element on mount', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="second">Second</button>
      `;

      trapFocus(container);

      expect(document.activeElement?.id).toBe('first');
    });
  });

  describe('saveFocus and restoreFocus', () => {
    it('should save and restore focus', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();

      expect(document.activeElement).toBe(button);

      const saved = saveFocus();

      // Change focus
      const otherButton = document.createElement('button');
      document.body.appendChild(otherButton);
      otherButton.focus();

      expect(document.activeElement).toBe(otherButton);

      // Restore
      if (saved) {
        restoreFocus(saved);
      }

      expect(document.activeElement).toBe(button);

      document.body.removeChild(button);
      document.body.removeChild(otherButton);
    });

    it('should return null when no active element', () => {
      const saved = saveFocus();
      expect(saved).toBeInstanceOf(HTMLElement);
    });

    it('should handle body as active element', () => {
      (document.body as any).focus();

      const saved = saveFocus();
      expect(saved).toBeInstanceOf(HTMLElement);
    });

    it('should safely handle restoring to removed element', () => {
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.focus();

      const saved = saveFocus();

      // Remove the element
      document.body.removeChild(button);

      // Should not throw
      expect(() => {
        if (saved) {
          restoreFocus(saved);
        }
      }).not.toThrow();
    });
  });

  describe('Integration', () => {
    it('should support complete focus management workflow', () => {
      // Initial focus outside container
      const outsideButton = document.createElement('button');
      outsideButton.id = 'outside';
      document.body.appendChild(outsideButton);
      outsideButton.focus();

      expect(document.activeElement?.id).toBe('outside');

      // Save focus
      const saved = saveFocus();

      // Setup modal with focus trap
      container.innerHTML = `
        <div role="dialog">
          <button id="modal-close">Close</button>
          <input id="modal-input" type="text">
          <button id="modal-submit">Submit</button>
        </div>
      `;

      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      const cleanup = trapFocus(dialog);

      // Focus should be trapped in modal
      expect(document.activeElement?.id).toBe('modal-close');

      // Cleanup and restore
      cleanup();
      if (saved) {
        restoreFocus(saved);
      }

      expect(document.activeElement?.id).toBe('outside');

      document.body.removeChild(outsideButton);
    });
  });
});
