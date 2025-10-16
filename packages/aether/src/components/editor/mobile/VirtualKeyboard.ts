/**
 * VirtualKeyboard Handler
 *
 * Manages virtual keyboard integration for mobile devices.
 * Handles viewport adjustments and cursor visibility.
 *
 * @module components/editor/mobile
 */

import { Extension } from '../core/Extension.js';
import type { EditorInstance } from '../core/types.js';

export interface VirtualKeyboardOptions {
  /**
   * Adjust viewport when keyboard opens
   * @default true
   */
  adjustViewport?: boolean;

  /**
   * Maintain cursor visibility
   * @default true
   */
  maintainCursorVisibility?: boolean;

  /**
   * Show format bar above keyboard
   * @default true
   */
  showFormatBar?: boolean;

  /**
   * Auto-scroll to cursor on keyboard open
   * @default true
   */
  autoScrollToCursor?: boolean;

  /**
   * Minimum spacing above cursor (in pixels)
   * @default 100
   */
  minCursorSpacing?: number;

  /**
   * Animation duration (in milliseconds)
   * @default 300
   */
  animationDuration?: number;
}

interface KeyboardState {
  isOpen: boolean;
  height: number;
  previousViewportHeight: number;
}

/**
 * VirtualKeyboard Extension
 *
 * Provides virtual keyboard integration including:
 * - Viewport adjustment when keyboard opens/closes
 * - Cursor visibility maintenance
 * - Format bar above keyboard
 * - Auto-scroll to cursor position
 * - Keyboard height detection
 * - iOS and Android support
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new VirtualKeyboardExtension({
 *       adjustViewport: true,
 *       maintainCursorVisibility: true,
 *       showFormatBar: true
 *     })
 *   ]
 * });
 * ```
 */
export class VirtualKeyboardExtension extends Extension {
  name = 'virtualKeyboard';
  type = 'behavior' as const;

  private options: Required<VirtualKeyboardOptions>;
  private keyboardState: KeyboardState = {
    isOpen: false,
    height: 0,
    previousViewportHeight: 0,
  };
  private formatBar: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private scrollTimeout: number | null = null;

  constructor(options: VirtualKeyboardOptions = {}) {
    super();
    this.options = {
      adjustViewport: options.adjustViewport ?? true,
      maintainCursorVisibility: options.maintainCursorVisibility ?? true,
      showFormatBar: options.showFormatBar ?? true,
      autoScrollToCursor: options.autoScrollToCursor ?? true,
      minCursorSpacing: options.minCursorSpacing ?? 100,
      animationDuration: options.animationDuration ?? 300,
    };
  }

  /**
   * Extension lifecycle: onCreate
   */
  onCreate(editor: EditorInstance): void {
    (this as any).editor = editor;

    this.initializeKeyboardDetection();
    this.setupViewportHandling();
    this.setupFocusHandling(editor);

    if (this.options.showFormatBar) {
      this.createFormatBar(editor);
    }
  }

  /**
   * Initialize keyboard detection
   */
  private initializeKeyboardDetection(): void {
    // Store initial viewport height
    this.keyboardState.previousViewportHeight = window.visualViewport?.height || window.innerHeight;

    // Listen for visual viewport changes (reliable for keyboard detection)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        this.handleViewportResize();
      });

      window.visualViewport.addEventListener('scroll', () => {
        this.handleViewportScroll();
      });
    } else {
      // Fallback for browsers without visualViewport API
      window.addEventListener('resize', () => {
        this.handleViewportResize();
      });
    }

    // Listen for focusin/focusout events
    document.addEventListener('focusin', (e) => {
      if (this.isEditorElement(e.target as Element)) {
        this.handleEditorFocus();
      }
    });

    document.addEventListener('focusout', (e) => {
      if (this.isEditorElement(e.target as Element)) {
        this.handleEditorBlur();
      }
    });
  }

  /**
   * Setup viewport handling
   */
  private setupViewportHandling(): void {
    if (!this.options.adjustViewport) return;

    // Create ResizeObserver to detect viewport changes
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === document.body) {
          this.handleBodyResize();
        }
      }
    });

    this.resizeObserver.observe(document.body);

    // Add CSS for viewport adjustment
    this.addViewportStyles();
  }

  /**
   * Setup focus handling
   */
  private setupFocusHandling(editor: EditorInstance): void {
    // Listen for selection changes
    editor.signals.selection.subscribe((selection) => {
      if (this.keyboardState.isOpen && this.options.maintainCursorVisibility) {
        this.ensureCursorVisible(editor);
      }
    });

    // Listen for focus changes
    editor.signals.focused.subscribe((focused) => {
      if (focused && this.options.autoScrollToCursor) {
        setTimeout(() => {
          this.scrollToCursor(editor);
        }, this.options.animationDuration);
      }
    });
  }

  /**
   * Handle viewport resize (keyboard open/close)
   */
  private handleViewportResize(): void {
    const currentHeight = window.visualViewport?.height || window.innerHeight;
    const previousHeight = this.keyboardState.previousViewportHeight;

    const heightDiff = previousHeight - currentHeight;

    // Keyboard opened (viewport height decreased significantly)
    if (heightDiff > 150) {
      this.keyboardState.isOpen = true;
      this.keyboardState.height = heightDiff;
      this.onKeyboardOpen();
    }
    // Keyboard closed (viewport height increased)
    else if (heightDiff < -150 && this.keyboardState.isOpen) {
      this.keyboardState.isOpen = false;
      this.keyboardState.height = 0;
      this.onKeyboardClose();
    }

    this.keyboardState.previousViewportHeight = currentHeight;
  }

  /**
   * Handle viewport scroll
   */
  private handleViewportScroll(): void {
    if (this.formatBar && this.keyboardState.isOpen) {
      this.updateFormatBarPosition();
    }
  }

  /**
   * Handle body resize
   */
  private handleBodyResize(): void {
    if (this.keyboardState.isOpen && this.options.adjustViewport) {
      this.adjustEditorHeight();
    }
  }

  /**
   * Handle editor focus
   */
  private handleEditorFocus(): void {
    // Wait for keyboard to open
    setTimeout(() => {
      const editor = this.getEditorInstance();
      if (editor && this.options.autoScrollToCursor) {
        this.scrollToCursor(editor);
      }
    }, 300);
  }

  /**
   * Handle editor blur
   */
  private handleEditorBlur(): void {
    // Keyboard will close soon
  }

  /**
   * Callback when keyboard opens
   */
  private onKeyboardOpen(): void {
    const editor = this.getEditorInstance();
    if (!editor) return;

    // Add keyboard-open class
    document.body.classList.add('keyboard-open');

    // Adjust editor height
    if (this.options.adjustViewport) {
      this.adjustEditorHeight();
    }

    // Show format bar
    if (this.options.showFormatBar && this.formatBar) {
      this.showFormatBar();
    }

    // Ensure cursor is visible
    if (this.options.maintainCursorVisibility) {
      this.ensureCursorVisible(editor);
    }

    // Announce to screen readers
    if (editor.accessibility?.announce) {
      editor.accessibility.announce('Keyboard opened', 'polite');
    }
  }

  /**
   * Callback when keyboard closes
   */
  private onKeyboardClose(): void {
    const editor = this.getEditorInstance();
    if (!editor) return;

    // Remove keyboard-open class
    document.body.classList.remove('keyboard-open');

    // Restore editor height
    if (this.options.adjustViewport) {
      this.restoreEditorHeight();
    }

    // Hide format bar
    if (this.formatBar) {
      this.hideFormatBar();
    }

    // Announce to screen readers
    if (editor.accessibility?.announce) {
      editor.accessibility.announce('Keyboard closed', 'polite');
    }
  }

  /**
   * Adjust editor height for keyboard
   */
  private adjustEditorHeight(): void {
    const editor = this.getEditorInstance();
    if (!editor) return;

    const container = editor.view.dom.closest('.editor-container') as HTMLElement;
    if (!container) return;

    const keyboardHeight = this.keyboardState.height;
    const formatBarHeight = this.formatBar ? this.formatBar.offsetHeight : 0;

    container.style.maxHeight = `calc(100vh - ${keyboardHeight + formatBarHeight}px)`;
    container.style.transition = `max-height ${this.options.animationDuration}ms ease`;
  }

  /**
   * Restore editor height
   */
  private restoreEditorHeight(): void {
    const editor = this.getEditorInstance();
    if (!editor) return;

    const container = editor.view.dom.closest('.editor-container') as HTMLElement;
    if (!container) return;

    container.style.maxHeight = '';
  }

  /**
   * Ensure cursor is visible
   */
  private ensureCursorVisible(editor: EditorInstance): void {
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    this.scrollTimeout = window.setTimeout(() => {
      this.scrollToCursor(editor);
    }, 100);
  }

  /**
   * Scroll to cursor position
   */
  private scrollToCursor(editor: EditorInstance): void {
    try {
      const { from } = editor.view.state.selection;
      const coords = editor.view.coordsAtPos(from);

      const container = editor.view.dom.closest('.editor-container') || window;
      const scrollTop = container === window ? window.scrollY : (container as HTMLElement).scrollTop;

      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const keyboardHeight = this.keyboardState.height;
      const formatBarHeight = this.formatBar ? this.formatBar.offsetHeight : 0;

      const availableHeight = viewportHeight - keyboardHeight - formatBarHeight;
      const cursorY = coords.top;

      // Calculate desired scroll position
      const desiredScrollTop = cursorY - availableHeight + this.options.minCursorSpacing;

      if (desiredScrollTop > scrollTop) {
        if (container === window) {
          window.scrollTo({
            top: desiredScrollTop,
            behavior: 'smooth',
          });
        } else {
          (container as HTMLElement).scrollTo({
            top: desiredScrollTop,
            behavior: 'smooth',
          });
        }
      }
    } catch (_e) {
      // Position might be invalid, ignore
    }
  }

  /**
   * Create format bar
   */
  private createFormatBar(editor: EditorInstance): void {
    this.formatBar = document.createElement('div');
    this.formatBar.className = 'virtual-keyboard-format-bar';
    this.formatBar.setAttribute('role', 'toolbar');
    this.formatBar.setAttribute('aria-label', 'Text formatting');

    // Add common formatting buttons
    const buttons = [
      { icon: 'B', label: 'Bold', command: 'bold' },
      { icon: 'I', label: 'Italic', command: 'italic' },
      { icon: 'U', label: 'Underline', command: 'underline' },
      { icon: '🔗', label: 'Link', command: 'link' },
    ];

    buttons.forEach((btn) => {
      const button = document.createElement('button');
      button.className = 'format-bar-button';
      button.textContent = btn.icon;
      button.setAttribute('aria-label', btn.label);
      button.addEventListener('click', () => {
        editor.commands.execute(btn.command);
      });
      this.formatBar!.appendChild(button);
    });

    document.body.appendChild(this.formatBar);
    this.formatBar.style.display = 'none';
  }

  /**
   * Show format bar
   */
  private showFormatBar(): void {
    if (!this.formatBar) return;

    this.formatBar.style.display = 'flex';
    this.updateFormatBarPosition();

    // Animate in
    requestAnimationFrame(() => {
      this.formatBar!.classList.add('visible');
    });
  }

  /**
   * Hide format bar
   */
  private hideFormatBar(): void {
    if (!this.formatBar) return;

    this.formatBar.classList.remove('visible');

    setTimeout(() => {
      if (this.formatBar) {
        this.formatBar.style.display = 'none';
      }
    }, this.options.animationDuration);
  }

  /**
   * Update format bar position
   */
  private updateFormatBarPosition(): void {
    if (!this.formatBar) return;

    const _viewportHeight = window.visualViewport?.height || window.innerHeight;
    const keyboardHeight = this.keyboardState.height;

    this.formatBar.style.bottom = `${keyboardHeight}px`;
  }

  /**
   * Add viewport styles
   */
  private addViewportStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      body.keyboard-open {
        overflow: hidden;
      }

      .virtual-keyboard-format-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        gap: 8px;
        padding: 8px;
        background: var(--toolbar-bg, #fff);
        border-top: 1px solid var(--border-color, #e0e0e0);
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
        z-index: 1001;
        transform: translateY(100%);
        transition: transform ${this.options.animationDuration}ms ease;
      }

      .virtual-keyboard-format-bar.visible {
        transform: translateY(0);
      }

      .format-bar-button {
        min-width: 44px;
        min-height: 44px;
        padding: 8px;
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 8px;
        background: var(--button-bg, #f5f5f5);
        font-size: 18px;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }

      .format-bar-button:active {
        transform: scale(0.95);
        background: var(--button-active-bg, #e0e0e0);
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Check if element is part of editor
   */
  private isEditorElement(element: Element): boolean {
    const editor = this.getEditorInstance();
    if (!editor) return false;

    const container = editor.view.dom.closest('.editor-container');
    return container ? container.contains(element) : false;
  }

  /**
   * Get editor instance
   */
  private getEditorInstance(): EditorInstance | null {
    return (this as any).editor || null;
  }

  /**
   * Get keyboard state
   */
  getKeyboardState(): KeyboardState {
    return { ...this.keyboardState };
  }

  /**
   * Check if keyboard is open
   */
  isKeyboardOpen(): boolean {
    return this.keyboardState.isOpen;
  }

  /**
   * Get keyboard height
   */
  getKeyboardHeight(): number {
    return this.keyboardState.height;
  }

  /**
   * Extension lifecycle: onDestroy
   */
  onDestroy(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.formatBar) {
      this.formatBar.remove();
      this.formatBar = null;
    }

    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = null;
    }

    document.body.classList.remove('keyboard-open');
  }
}
