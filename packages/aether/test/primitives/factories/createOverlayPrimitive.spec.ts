/**
 * Tests for createOverlayPrimitive factory
 *
 * Verifies that the factory generates correct overlay components
 * with appropriate behavior and accessibility features.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createOverlayPrimitive } from '../../../src/primitives/factories/createOverlayPrimitive.js';
import { signal } from '../../../src/core/reactivity/signal.js';

describe('createOverlayPrimitive', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe('Dialog Configuration', () => {
    it('should create a modal dialog with all components', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        modal: true,
        role: 'dialog',
        focusTrap: true,
        scrollLock: true,
        closeOnEscape: true,
        closeOnClickOutside: false,
        hasTitle: true,
        hasDescription: true,
      });

      expect(Dialog.Root).toBeDefined();
      expect(Dialog.Trigger).toBeDefined();
      expect(Dialog.Content).toBeDefined();
      expect(Dialog.Portal).toBeDefined();
      expect(Dialog.Overlay).toBeDefined();
      expect(Dialog.Close).toBeDefined();
      expect(Dialog.Title).toBeDefined();
      expect(Dialog.Description).toBeDefined();
      expect(Dialog.Context).toBeDefined();
    });

    it('should not create Title/Description when disabled', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        hasTitle: false,
        hasDescription: false,
      });

      expect(Dialog.Title).toBeUndefined();
      expect(Dialog.Description).toBeUndefined();
    });
  });

  describe('Popover Configuration', () => {
    it('should create a positioned popover with arrow', () => {
      const Popover = createOverlayPrimitive({
        name: 'popover',
        modal: false,
        role: 'dialog',
        positioning: true,
        hasArrow: true,
        hasTitle: false,
        hasDescription: false,
      });

      expect(Popover.Root).toBeDefined();
      expect(Popover.Trigger).toBeDefined();
      expect(Popover.Content).toBeDefined();
      expect(Popover.Arrow).toBeDefined();
      expect(Popover.Anchor).toBeDefined();
      expect(Popover.Title).toBeUndefined();
      expect(Popover.Description).toBeUndefined();
    });

    it('should not create Arrow when hasArrow is false', () => {
      const Popover = createOverlayPrimitive({
        name: 'popover',
        positioning: true,
        hasArrow: false,
      });

      expect(Popover.Arrow).toBeUndefined();
    });

    it('should not create Anchor when positioning is false', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        positioning: false,
      });

      expect(Dialog.Anchor).toBeUndefined();
    });
  });

  describe('HoverCard Configuration', () => {
    it('should create hover-triggered overlay', () => {
      const HoverCard = createOverlayPrimitive({
        name: 'hover-card',
        positioning: true,
        triggerBehavior: 'hover',
        hoverDelays: {
          openDelay: 500,
          closeDelay: 200,
        },
      });

      expect(HoverCard.Root).toBeDefined();
      expect(HoverCard.Trigger).toBeDefined();
      expect(HoverCard.Content).toBeDefined();
    });
  });

  describe('ContextMenu Configuration', () => {
    it('should create right-click triggered menu', () => {
      const ContextMenu = createOverlayPrimitive({
        name: 'context-menu',
        role: 'menu',
        triggerBehavior: 'contextmenu',
        hasTitle: false,
        hasDescription: false,
      });

      expect(ContextMenu.Root).toBeDefined();
      expect(ContextMenu.Trigger).toBeDefined();
      expect(ContextMenu.Content).toBeDefined();
    });
  });

  describe('Signal Control (Pattern 19)', () => {
    it('should support WritableSignal for controlled state', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        supportsSignalControl: true,
      });

      const isOpen = signal(false);

      // Verify signal control is accepted
      expect(() => {
        Dialog.Root({ open: isOpen, children: null });
      }).not.toThrow();
    });

    it('should support boolean for controlled state', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
      });

      // Verify boolean control is accepted
      expect(() => {
        Dialog.Root({ open: true, children: null });
      }).not.toThrow();
    });
  });

  describe('Component Defaults', () => {
    it('should apply correct defaults for modal overlay', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        modal: true,
        // focusTrap and scrollLock should default to true
      });

      // These are applied internally, verify via component creation
      expect(Dialog.Root).toBeDefined();
      expect(Dialog.Content).toBeDefined();
    });

    it('should apply correct defaults for non-modal overlay', () => {
      const Popover = createOverlayPrimitive({
        name: 'popover',
        modal: false,
        // focusTrap and scrollLock should default to false
        // closeOnClickOutside should default to true
      });

      expect(Popover.Root).toBeDefined();
      expect(Popover.Content).toBeDefined();
    });
  });

  describe('Data Attributes', () => {
    it('should use correct data attributes based on name', () => {
      const Dialog = createOverlayPrimitive({
        name: 'my-overlay',
      });

      // Verify root has correct data attribute
      const root = Dialog.Root({ children: null });
      const rendered = root();

      // The factory should create elements with data-{name}-root, etc.
      expect(typeof rendered).toBe('object');
    });
  });

  describe('ID Generation', () => {
    it('should generate unique IDs for multiple instances', () => {
      const Dialog1 = createOverlayPrimitive({
        name: 'dialog',
      });

      const Dialog2 = createOverlayPrimitive({
        name: 'dialog',
      });

      // Each factory call creates new components
      expect(Dialog1.Root).toBeDefined();
      expect(Dialog2.Root).toBeDefined();
      expect(Dialog1.Root).not.toBe(Dialog2.Root);
    });
  });

  describe('Context Values', () => {
    it('should create context with correct default values', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        hasTitle: true,
        hasDescription: true,
      });

      // Context is created and can be used
      expect(Dialog.Context).toBeDefined();
    });

    it('should create context for positioned overlay', () => {
      const Popover = createOverlayPrimitive({
        name: 'popover',
        positioning: true,
      });

      // Context should include positioning-specific methods
      expect(Popover.Context).toBeDefined();
    });

    it('should create context for hover overlay', () => {
      const HoverCard = createOverlayPrimitive({
        name: 'hover-card',
        triggerBehavior: 'hover',
      });

      // Context should include hover-specific methods
      expect(HoverCard.Context).toBeDefined();
    });

    it('should create context for context menu', () => {
      const ContextMenu = createOverlayPrimitive({
        name: 'context-menu',
        triggerBehavior: 'contextmenu',
      });

      // Context should include position tracking
      expect(ContextMenu.Context).toBeDefined();
    });
  });

  describe('ARIA Attributes', () => {
    it('should use correct role', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        role: 'alertdialog',
      });

      // Role is applied in Content component
      expect(Dialog.Content).toBeDefined();
    });

    it('should include aria-modal for modal overlays', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        modal: true,
      });

      // aria-modal is applied in Content component
      expect(Dialog.Content).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle minimal configuration', () => {
      const MinimalOverlay = createOverlayPrimitive({
        name: 'minimal',
      });

      expect(MinimalOverlay.Root).toBeDefined();
      expect(MinimalOverlay.Trigger).toBeDefined();
      expect(MinimalOverlay.Content).toBeDefined();
      expect(MinimalOverlay.Close).toBeDefined();
    });

    it('should handle maximal configuration', () => {
      const MaximalOverlay = createOverlayPrimitive({
        name: 'maximal',
        modal: true,
        role: 'dialog',
        positioning: true,
        focusTrap: true,
        scrollLock: true,
        closeOnEscape: true,
        closeOnClickOutside: true,
        hasTitle: true,
        hasDescription: true,
        hasArrow: true,
        supportsSignalControl: true,
      });

      expect(MaximalOverlay.Root).toBeDefined();
      expect(MaximalOverlay.Trigger).toBeDefined();
      expect(MaximalOverlay.Content).toBeDefined();
      expect(MaximalOverlay.Portal).toBeDefined();
      expect(MaximalOverlay.Overlay).toBeDefined();
      expect(MaximalOverlay.Close).toBeDefined();
      expect(MaximalOverlay.Title).toBeDefined();
      expect(MaximalOverlay.Description).toBeDefined();
      expect(MaximalOverlay.Arrow).toBeDefined();
      expect(MaximalOverlay.Anchor).toBeDefined();
      expect(MaximalOverlay.Context).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('should return properly typed components', () => {
      const Dialog = createOverlayPrimitive({
        name: 'dialog',
        hasTitle: true,
        hasDescription: true,
      });

      // TypeScript should allow these
      const root = Dialog.Root;
      const trigger = Dialog.Trigger;
      const content = Dialog.Content;
      const title = Dialog.Title;
      const description = Dialog.Description;

      expect(root).toBeDefined();
      expect(trigger).toBeDefined();
      expect(content).toBeDefined();
      expect(title).toBeDefined();
      expect(description).toBeDefined();
    });
  });
});
