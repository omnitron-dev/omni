/**
 * KeyboardNavigation Extension
 *
 * Provides enhanced keyboard navigation for accessibility compliance.
 * Implements WCAG 2.1 keyboard accessibility guidelines.
 *
 * @module components/editor/accessibility
 */

import { Extension } from '../core/Extension.js';
import type { EditorInstance } from '../core/types.js';
import type { Command } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';

export interface KeyboardNavigationOptions {
  /**
   * Enable keyboard shortcuts help panel
   * @default true
   */
  enableHelp?: boolean;

  /**
   * Key combination to open help panel
   * @default 'Mod-/'
   */
  helpKey?: string;

  /**
   * Enable escape key handling
   * @default true
   */
  enableEscape?: boolean;

  /**
   * Enable toolbar keyboard navigation
   * @default true
   */
  enableToolbarNav?: boolean;

  /**
   * Enable document navigation shortcuts
   * @default true
   */
  enableDocumentNav?: boolean;

  /**
   * Custom keyboard shortcuts
   */
  customShortcuts?: Record<string, () => boolean>;
}

interface KeyboardShortcut {
  key: string;
  description: string;
  command: string | (() => boolean);
  group: string;
}

/**
 * KeyboardNavigation Extension
 *
 * Provides comprehensive keyboard navigation support including:
 * - Document navigation (Ctrl+Home, Ctrl+End, Page Up/Down)
 * - Toolbar and menu navigation (Tab, Arrow keys)
 * - Keyboard shortcuts help panel (Ctrl+/)
 * - Focus management and restoration
 * - Escape key handling for modals and panels
 * - Screen reader friendly navigation
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new KeyboardNavigationExtension({
 *       enableHelp: true,
 *       helpKey: 'Mod-/',
 *       enableToolbarNav: true
 *     })
 *   ]
 * });
 * ```
 */
export class KeyboardNavigationExtension extends Extension {
  name = 'keyboardNavigation';
  type = 'behavior' as const;

  private shortcuts: KeyboardShortcut[] = [];
  private helpPanelOpen = false;
  private lastFocusedElement: HTMLElement | null = null;
  private keyboardOnlyMode = false;

  constructor(private options: KeyboardNavigationOptions = {}) {
    super();
    this.initializeShortcuts();
  }

  /**
   * Initialize keyboard shortcuts registry
   */
  private initializeShortcuts(): void {
    // Text formatting shortcuts
    this.shortcuts.push(
      { key: 'Mod-b', description: 'Toggle bold', command: 'bold', group: 'Formatting' },
      { key: 'Mod-i', description: 'Toggle italic', command: 'italic', group: 'Formatting' },
      { key: 'Mod-u', description: 'Toggle underline', command: 'underline', group: 'Formatting' },
      {
        key: 'Mod-Shift-x',
        description: 'Toggle strikethrough',
        command: 'strike',
        group: 'Formatting',
      },
      { key: 'Mod-e', description: 'Toggle code', command: 'code', group: 'Formatting' },
    );

    // Navigation shortcuts
    this.shortcuts.push(
      { key: 'Ctrl-Home', description: 'Go to document start', command: 'goToStart', group: 'Navigation' },
      { key: 'Ctrl-End', description: 'Go to document end', command: 'goToEnd', group: 'Navigation' },
      { key: 'PageUp', description: 'Scroll up one page', command: 'pageUp', group: 'Navigation' },
      { key: 'PageDown', description: 'Scroll down one page', command: 'pageDown', group: 'Navigation' },
      { key: 'Alt-ArrowUp', description: 'Previous paragraph', command: 'prevParagraph', group: 'Navigation' },
      {
        key: 'Alt-ArrowDown',
        description: 'Next paragraph',
        command: 'nextParagraph',
        group: 'Navigation',
      },
      { key: 'Alt-h', description: 'Previous heading', command: 'prevHeading', group: 'Navigation' },
      { key: 'Alt-Shift-h', description: 'Next heading', command: 'nextHeading', group: 'Navigation' },
    );

    // Editing shortcuts
    this.shortcuts.push(
      { key: 'Mod-z', description: 'Undo', command: 'undo', group: 'Editing' },
      { key: 'Mod-y', description: 'Redo', command: 'redo', group: 'Editing' },
      { key: 'Mod-a', description: 'Select all', command: 'selectAll', group: 'Editing' },
      { key: 'Mod-x', description: 'Cut', command: 'cut', group: 'Editing' },
      { key: 'Mod-c', description: 'Copy', command: 'copy', group: 'Editing' },
      { key: 'Mod-v', description: 'Paste', command: 'paste', group: 'Editing' },
    );

    // Search shortcuts
    this.shortcuts.push(
      { key: 'Mod-f', description: 'Find', command: 'search', group: 'Search' },
      { key: 'Mod-g', description: 'Find next', command: 'searchNext', group: 'Search' },
      { key: 'Mod-Shift-g', description: 'Find previous', command: 'searchPrev', group: 'Search' },
      { key: 'Mod-h', description: 'Find and replace', command: 'searchReplace', group: 'Search' },
    );

    // Help shortcut
    if (this.options.enableHelp !== false) {
      this.shortcuts.push({
        key: this.options.helpKey || 'Mod-/',
        description: 'Show keyboard shortcuts',
        command: () => this.toggleHelpPanel(),
        group: 'Help',
      });
    }

    // Escape shortcut
    if (this.options.enableEscape !== false) {
      this.shortcuts.push({
        key: 'Escape',
        description: 'Close panels and modals',
        command: () => this.handleEscape(),
        group: 'General',
      });
    }

    // Add custom shortcuts
    if (this.options.customShortcuts) {
      Object.entries(this.options.customShortcuts).forEach(([key, command]) => {
        this.shortcuts.push({
          key,
          description: 'Custom shortcut',
          command,
          group: 'Custom',
        });
      });
    }
  }

  /**
   * Create keyboard event handler
   */
  keymap(): Record<string, Command> {
    const commands: Record<string, Command> = {};

    // Register all shortcuts
    this.shortcuts.forEach((shortcut) => {
      commands[shortcut.key] = (state, dispatch) => {
        if (typeof shortcut.command === 'function') {
          return shortcut.command();
        }
        return false; // Let other handlers process named commands
      };
    });

    // Document navigation commands
    if (this.options.enableDocumentNav !== false) {
      commands['Ctrl-Home'] = (state, dispatch) => {
        if (dispatch) {
          const tr = state.tr.setSelection(TextSelection.atStart(state.doc));
          dispatch(tr.scrollIntoView());
        }
        return true;
      };

      commands['Ctrl-End'] = (state, dispatch) => {
        if (dispatch) {
          const tr = state.tr.setSelection(TextSelection.atEnd(state.doc));
          dispatch(tr.scrollIntoView());
        }
        return true;
      };

      commands['PageUp'] = (state, dispatch) => {
        this.scrollPage(-1);
        return true;
      };

      commands['PageDown'] = (state, dispatch) => {
        this.scrollPage(1);
        return true;
      };

      commands['Alt-ArrowUp'] = (state, dispatch) => this.navigateToParagraph(state, dispatch, -1);

      commands['Alt-ArrowDown'] = (state, dispatch) => this.navigateToParagraph(state, dispatch, 1);

      commands['Alt-h'] = (state, dispatch) => this.navigateToHeading(state, dispatch, -1);

      commands['Alt-Shift-h'] = (state, dispatch) => this.navigateToHeading(state, dispatch, 1);
    }

    // Tab handling for accessibility
    commands['Tab'] = (state, dispatch) => 
      // Allow tab to move to next focusable element
       false
    ;

    commands['Shift-Tab'] = (state, dispatch) => 
      // Allow shift-tab to move to previous focusable element
       false
    ;

    return commands;
  }

  /**
   * Scroll by one page viewport height
   */
  private scrollPage(direction: number): void {
    const editor = this.getEditorInstance();
    if (!editor) return;

    const scrollContainer = editor.view.dom.closest('.editor-container') || editor.view.dom;
    const viewportHeight = scrollContainer.clientHeight;
    scrollContainer.scrollTop += viewportHeight * direction;
  }

  /**
   * Navigate to previous/next paragraph
   */
  private navigateToParagraph(state: any, dispatch: any, direction: number): boolean {
    const { $from } = state.selection;
    let pos = $from.pos;
    let found = false;

    // Search for next paragraph node
    state.doc.nodesBetween(0, state.doc.content.size, (node: any, nodePos: number) => {
      if (found) return false;

      if (node.type.name === 'paragraph') {
        if (direction > 0 && nodePos > pos) {
          pos = nodePos;
          found = true;
        } else if (direction < 0 && nodePos < pos && nodePos > 0) {
          pos = nodePos;
        }
      }
    });

    if (found || (direction < 0 && pos !== $from.pos)) {
      if (dispatch) {
        const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    return false;
  }

  /**
   * Navigate to previous/next heading
   */
  private navigateToHeading(state: any, dispatch: any, direction: number): boolean {
    const { $from } = state.selection;
    let pos = $from.pos;
    let found = false;

    // Search for next heading node
    state.doc.nodesBetween(0, state.doc.content.size, (node: any, nodePos: number) => {
      if (found) return false;

      if (node.type.name === 'heading') {
        if (direction > 0 && nodePos > pos) {
          pos = nodePos;
          found = true;
        } else if (direction < 0 && nodePos < pos && nodePos > 0) {
          pos = nodePos;
        }
      }
    });

    if (found || (direction < 0 && pos !== $from.pos)) {
      if (dispatch) {
        const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(pos)));
        dispatch(tr.scrollIntoView());
      }
      return true;
    }

    return false;
  }

  /**
   * Toggle keyboard shortcuts help panel
   */
  private toggleHelpPanel(): boolean {
    this.helpPanelOpen = !this.helpPanelOpen;

    if (this.helpPanelOpen) {
      this.showHelpPanel();
    } else {
      this.hideHelpPanel();
    }

    return true;
  }

  /**
   * Show keyboard shortcuts help panel
   */
  private showHelpPanel(): void {
    const editor = this.getEditorInstance();
    if (!editor) return;

    // Create help panel
    const panel = document.createElement('div');
    panel.className = 'keyboard-shortcuts-help';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'keyboard-help-title');
    panel.setAttribute('aria-modal', 'true');

    // Group shortcuts by category
    const grouped = this.shortcuts.reduce(
      (acc, shortcut) => {
        if (!acc[shortcut.group]) {
          acc[shortcut.group] = [];
        }
        acc[shortcut.group].push(shortcut);
        return acc;
      },
      {} as Record<string, KeyboardShortcut[]>,
    );

    let html = '<div class="keyboard-help-content">';
    html += '<h2 id="keyboard-help-title">Keyboard Shortcuts</h2>';

    Object.entries(grouped).forEach(([group, shortcuts]) => {
      html += `<div class="shortcut-group"><h3>${group}</h3><dl>`;
      shortcuts.forEach((shortcut) => {
        const key = shortcut.key.replace('Mod', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');
        html += `<dt><kbd>${key}</kbd></dt><dd>${shortcut.description}</dd>`;
      });
      html += '</dl></div>';
    });

    html += '<button class="close-help" aria-label="Close help panel">Close (Esc)</button>';
    html += '</div>';

    panel.innerHTML = html;

    // Add close button handler
    const closeButton = panel.querySelector('.close-help') as HTMLButtonElement;
    closeButton?.addEventListener('click', () => this.hideHelpPanel());

    // Add to DOM
    const container = editor.view.dom.closest('.editor-container') || document.body;
    container.appendChild(panel);

    // Focus the panel for keyboard navigation
    panel.focus();

    // Trap focus within panel
    this.trapFocus(panel);
  }

  /**
   * Hide keyboard shortcuts help panel
   */
  private hideHelpPanel(): void {
    const panel = document.querySelector('.keyboard-shortcuts-help');
    if (panel) {
      panel.remove();
      this.helpPanelOpen = false;
    }

    // Restore focus to editor
    this.restoreFocus();
  }

  /**
   * Handle Escape key press
   */
  private handleEscape(): boolean {
    // Close help panel if open
    if (this.helpPanelOpen) {
      this.hideHelpPanel();
      return true;
    }

    // Close any open dropdowns
    const openDropdowns = document.querySelectorAll('.toolbar-dropdown-menu.open');
    openDropdowns.forEach((dropdown) => dropdown.classList.remove('open'));

    // Close search panel if open
    const searchPanel = document.querySelector('.search-panel.open');
    if (searchPanel) {
      searchPanel.classList.remove('open');
      return true;
    }

    // Close any modals
    const modals = document.querySelectorAll('[role="dialog"]');
    if (modals.length > 0) {
      modals.forEach((modal) => modal.remove());
      this.restoreFocus();
      return true;
    }

    return false;
  }

  /**
   * Trap focus within a container
   */
  private trapFocus(container: HTMLElement): void {
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

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
    firstElement.focus();
  }

  /**
   * Save current focus for restoration
   */
  private saveFocus(): void {
    this.lastFocusedElement = document.activeElement as HTMLElement;
  }

  /**
   * Restore saved focus
   */
  private restoreFocus(): void {
    if (this.lastFocusedElement) {
      this.lastFocusedElement.focus();
      this.lastFocusedElement = null;
    } else {
      // Focus editor by default
      const editor = this.getEditorInstance();
      if (editor) {
        editor.view.focus();
      }
    }
  }

  /**
   * Detect keyboard-only navigation mode
   */
  private detectKeyboardMode(): void {
    // Detect if user is navigating with keyboard only
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        this.keyboardOnlyMode = true;
        document.body.classList.add('keyboard-navigation');
      }
    });

    document.addEventListener('mousedown', () => {
      this.keyboardOnlyMode = false;
      document.body.classList.remove('keyboard-navigation');
    });
  }

  /**
   * Get editor instance (helper method)
   */
  private getEditorInstance(): EditorInstance | null {
    // This will be set when the extension is attached to an editor
    return (this as any).editor || null;
  }

  /**
   * Extension lifecycle: onCreate
   */
  onCreate(editor: EditorInstance): void {
    (this as any).editor = editor;
    this.detectKeyboardMode();

    // Add keyboard navigation class to editor
    editor.view.dom.setAttribute('role', 'textbox');
    editor.view.dom.setAttribute('aria-multiline', 'true');
    editor.view.dom.setAttribute('aria-label', 'Rich text editor');

    // Initialize accessibility object if not exists
    if (!editor.accessibility) {
      editor.accessibility = {};
    }

    // Expose keyboard navigation methods
    editor.accessibility.showShortcuts = () => this.showHelpPanel();
    editor.accessibility.getShortcuts = () => this.shortcuts;
  }

  /**
   * Extension lifecycle: onDestroy
   */
  onDestroy(): void {
    this.hideHelpPanel();
    this.lastFocusedElement = null;
  }
}
