/**
 * FocusManager
 *
 * Manages focus within the editor for accessibility compliance.
 * Implements WCAG 2.1 focus management guidelines.
 *
 * @module components/editor/accessibility
 */

import type { EditorInstance } from '../core/types.js';

export interface FocusManagerOptions {
  /**
   * Show visible focus indicators
   * @default true
   */
  showFocusIndicators?: boolean;

  /**
   * Enable focus trap in modals
   * @default true
   */
  enableFocusTrap?: boolean;

  /**
   * Restore focus after operations
   * @default true
   */
  restoreFocus?: boolean;

  /**
   * CSS class for focus visible
   * @default 'focus-visible'
   */
  focusVisibleClass?: string;

  /**
   * CSS class for keyboard mode
   * @default 'keyboard-mode'
   */
  keyboardModeClass?: string;
}

export interface FocusableElement {
  element: HTMLElement;
  index: number;
  group?: string;
}

/**
 * FocusManager class
 *
 * Provides comprehensive focus management including:
 * - Focus tracking and restoration
 * - Focus visible indicators
 * - Keyboard-only mode detection
 * - Focus trap utilities
 * - Focus groups for toolbar/menu navigation
 * - Focus history for back/forward navigation
 *
 * @example
 * ```typescript
 * const focusManager = new FocusManager(editor, {
 *   showFocusIndicators: true,
 *   enableFocusTrap: true,
 *   restoreFocus: true
 * });
 *
 * focusManager.saveFocus();
 * // ... perform operation ...
 * focusManager.restoreFocus();
 * ```
 */
export class FocusManager {
  private editor: EditorInstance;
  private options: Required<FocusManagerOptions>;
  private focusHistory: HTMLElement[] = [];
  private currentFocus: HTMLElement | null = null;
  private keyboardMode = false;
  private focusTraps = new Map<string, HTMLElement>();
  private focusGroups = new Map<string, FocusableElement[]>();

  constructor(editor: EditorInstance, options: FocusManagerOptions = {}) {
    this.editor = editor;
    this.options = {
      showFocusIndicators: options.showFocusIndicators ?? true,
      enableFocusTrap: options.enableFocusTrap ?? true,
      restoreFocus: options.restoreFocus ?? true,
      focusVisibleClass: options.focusVisibleClass || 'focus-visible',
      keyboardModeClass: options.keyboardModeClass || 'keyboard-mode',
    };

    this.initialize();
  }

  /**
   * Initialize focus manager
   */
  private initialize(): void {
    this.detectKeyboardMode();
    this.trackFocus();
    this.setupFocusIndicators();
  }

  /**
   * Detect keyboard-only navigation mode
   */
  private detectKeyboardMode(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        this.keyboardMode = true;
        document.body.classList.add(this.options.keyboardModeClass);
      }
    });

    document.addEventListener('mousedown', () => {
      this.keyboardMode = false;
      document.body.classList.remove(this.options.keyboardModeClass);
    });

    document.addEventListener('touchstart', () => {
      this.keyboardMode = false;
      document.body.classList.remove(this.options.keyboardModeClass);
    });
  }

  /**
   * Track focus changes
   */
  private trackFocus(): void {
    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement;
      if (this.isInEditor(target)) {
        this.currentFocus = target;
        this.addToHistory(target);
      }
    });

    document.addEventListener('focusout', (e) => {
      // Don't clear current focus immediately - wait for next focus
      setTimeout(() => {
        if (!document.activeElement || !this.isInEditor(document.activeElement as HTMLElement)) {
          this.currentFocus = null;
        }
      }, 0);
    });
  }

  /**
   * Check if element is within editor
   */
  private isInEditor(element: HTMLElement): boolean {
    const editorContainer = this.editor.view.dom.closest('.editor-container');
    return editorContainer ? editorContainer.contains(element) : false;
  }

  /**
   * Add element to focus history
   */
  private addToHistory(element: HTMLElement): void {
    // Remove from history if already exists
    this.focusHistory = this.focusHistory.filter((el) => el !== element);

    // Add to end of history
    this.focusHistory.push(element);

    // Limit history size
    if (this.focusHistory.length > 20) {
      this.focusHistory.shift();
    }
  }

  /**
   * Setup focus visible indicators
   */
  private setupFocusIndicators(): void {
    if (!this.options.showFocusIndicators) return;

    // Add focus-visible class when focusing with keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement && this.isInEditor(activeElement)) {
          activeElement.classList.add(this.options.focusVisibleClass);
        }
      }
    });

    // Remove focus-visible class on mouse/touch
    document.addEventListener('mousedown', () => {
      const focusedElements = document.querySelectorAll(`.${this.options.focusVisibleClass}`);
      focusedElements.forEach((el) => el.classList.remove(this.options.focusVisibleClass));
    });
  }

  /**
   * Save current focus
   */
  saveFocus(): void {
    this.currentFocus = document.activeElement as HTMLElement;
  }

  /**
   * Restore saved focus
   */
  restoreFocus(): void {
    if (this.options.restoreFocus && this.currentFocus && document.body.contains(this.currentFocus)) {
      this.currentFocus.focus();
    } else {
      this.focusEditor();
    }
  }

  /**
   * Focus the editor
   */
  focusEditor(): void {
    this.editor.view.focus();
  }

  /**
   * Focus element by selector
   */
  focus(selector: string): boolean {
    const element = document.querySelector(selector) as HTMLElement;
    if (element) {
      element.focus();
      return true;
    }
    return false;
  }

  /**
   * Get current focused element
   */
  getCurrentFocus(): HTMLElement | null {
    return this.currentFocus;
  }

  /**
   * Get focus history
   */
  getFocusHistory(): HTMLElement[] {
    return [...this.focusHistory];
  }

  /**
   * Go back in focus history
   */
  focusBack(): boolean {
    if (this.focusHistory.length < 2) return false;

    // Remove current focus
    this.focusHistory.pop();

    // Get previous focus
    const previous = this.focusHistory[this.focusHistory.length - 1];
    if (previous && document.body.contains(previous)) {
      previous.focus();
      return true;
    }

    return false;
  }

  /**
   * Check if keyboard mode is active
   */
  isKeyboardMode(): boolean {
    return this.keyboardMode;
  }

  /**
   * Create a focus trap
   */
  createFocusTrap(container: HTMLElement, id: string): void {
    if (!this.options.enableFocusTrap) return;

    this.focusTraps.set(id, container);

    const focusableElements = this.getFocusableElements(container);
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0].element;
    const lastElement = focusableElements[focusableElements.length - 1].element;

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleTabKey);
    container.setAttribute('data-focus-trap', id);

    // Focus first element
    firstElement.focus();
  }

  /**
   * Remove a focus trap
   */
  removeFocusTrap(id: string): void {
    const container = this.focusTraps.get(id);
    if (container) {
      container.removeAttribute('data-focus-trap');
      this.focusTraps.delete(id);
      this.restoreFocus();
    }
  }

  /**
   * Get all focusable elements in a container
   */
  getFocusableElements(container: HTMLElement = document.body): FocusableElement[] {
    const selectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ].join(', ');

    const elements = Array.from(container.querySelectorAll(selectors)) as HTMLElement[];

    return elements
      .filter((el) => {
        // Filter out hidden elements
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
      })
      .map((element, index) => ({
        element,
        index,
        group: element.getAttribute('data-focus-group') || undefined,
      }));
  }

  /**
   * Register a focus group
   */
  registerFocusGroup(groupId: string, container: HTMLElement): void {
    const elements = this.getFocusableElements(container);
    elements.forEach((el) => {
      el.group = groupId;
      el.element.setAttribute('data-focus-group', groupId);
    });
    this.focusGroups.set(groupId, elements);
  }

  /**
   * Navigate within a focus group
   */
  navigateGroup(groupId: string, direction: 'next' | 'prev' | 'first' | 'last'): boolean {
    const group = this.focusGroups.get(groupId);
    if (!group || group.length === 0) return false;

    const currentIndex = group.findIndex((el) => el.element === document.activeElement);

    let nextIndex: number;

    switch (direction) {
      case 'first':
        nextIndex = 0;
        break;
      case 'last':
        nextIndex = group.length - 1;
        break;
      case 'next':
        nextIndex = currentIndex < group.length - 1 ? currentIndex + 1 : 0;
        break;
      case 'prev':
        nextIndex = currentIndex > 0 ? currentIndex - 1 : group.length - 1;
        break;
      default:
        return false;
    }

    const element = group[nextIndex];
    if (element) {
      element.element.focus();
      return true;
    }

    return false;
  }

  /**
   * Focus first element in a group
   */
  focusFirstInGroup(groupId: string): boolean {
    return this.navigateGroup(groupId, 'first');
  }

  /**
   * Focus last element in a group
   */
  focusLastInGroup(groupId: string): boolean {
    return this.navigateGroup(groupId, 'last');
  }

  /**
   * Focus next element in a group
   */
  focusNextInGroup(groupId: string): boolean {
    return this.navigateGroup(groupId, 'next');
  }

  /**
   * Focus previous element in a group
   */
  focusPrevInGroup(groupId: string): boolean {
    return this.navigateGroup(groupId, 'prev');
  }

  /**
   * Set focus visible class
   */
  setFocusVisible(element: HTMLElement, visible: boolean): void {
    if (visible) {
      element.classList.add(this.options.focusVisibleClass);
    } else {
      element.classList.remove(this.options.focusVisibleClass);
    }
  }

  /**
   * Check if focus is trapped
   */
  isFocusTrapped(): boolean {
    return this.focusTraps.size > 0;
  }

  /**
   * Get all active focus traps
   */
  getActiveFocusTraps(): string[] {
    return Array.from(this.focusTraps.keys());
  }

  /**
   * Destroy focus manager
   */
  destroy(): void {
    // Remove all focus traps
    this.focusTraps.forEach((container, id) => {
      this.removeFocusTrap(id);
    });

    // Clear history
    this.focusHistory = [];
    this.currentFocus = null;
    this.focusGroups.clear();
  }
}

/**
 * Create a focus manager instance
 */
export function createFocusManager(editor: EditorInstance, options?: FocusManagerOptions): FocusManager {
  return new FocusManager(editor, options);
}
