/**
 * TouchHandler Extension
 *
 * Provides touch event handling for mobile devices.
 * Implements mobile-friendly gestures and interactions.
 *
 * @module components/editor/mobile
 */

import { Extension } from '../core/Extension.js';
import type { EditorInstance } from '../core/types.js';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface TouchHandlerOptions {
  /**
   * Enable long-press for context menu
   * @default true
   */
  enableLongPress?: boolean;

  /**
   * Long press duration in milliseconds
   * @default 500
   */
  longPressDuration?: number;

  /**
   * Enable swipe gestures
   * @default true
   */
  enableSwipe?: boolean;

  /**
   * Swipe threshold in pixels
   * @default 50
   */
  swipeThreshold?: number;

  /**
   * Enable pinch-to-zoom prevention
   * @default true
   */
  preventPinchZoom?: boolean;

  /**
   * Enable touch selection handles
   * @default true
   */
  enableTouchHandles?: boolean;

  /**
   * Minimum touch target size in pixels
   * @default 44
   */
  minTouchTarget?: number;

  /**
   * Enable momentum scrolling
   * @default true
   */
  enableMomentumScroll?: boolean;

  /**
   * Enable double-tap to select word
   * @default true
   */
  enableDoubleTapSelect?: boolean;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  lastX: number;
  lastY: number;
  isLongPress: boolean;
  longPressTimer: number | null;
  touchCount: number;
  lastTapTime: number;
}

/**
 * TouchHandler Extension
 *
 * Provides comprehensive touch support including:
 * - Long-press for context menu (500ms default)
 * - Swipe left/right for undo/redo
 * - Pinch-to-zoom prevention
 * - Touch selection handles
 * - Double-tap to select word
 * - Triple-tap to select paragraph
 * - Touch-friendly tap targets (44x44px minimum)
 * - Momentum scrolling support
 *
 * @example
 * ```typescript
 * const editor = new AdvancedEditor({
 *   extensions: [
 *     new TouchHandlerExtension({
 *       enableLongPress: true,
 *       enableSwipe: true,
 *       preventPinchZoom: true
 *     })
 *   ]
 * });
 * ```
 */
export class TouchHandlerExtension extends Extension {
  name = 'touchHandler';
  type = 'behavior' as const;

  private options: Required<TouchHandlerOptions>;
  private touchState: TouchState | null = null;
  private selectionHandles: { start: HTMLElement; end: HTMLElement } | null = null;

  constructor(options: TouchHandlerOptions = {}) {
    super();
    this.options = {
      enableLongPress: options.enableLongPress ?? true,
      longPressDuration: options.longPressDuration ?? 500,
      enableSwipe: options.enableSwipe ?? true,
      swipeThreshold: options.swipeThreshold ?? 50,
      preventPinchZoom: options.preventPinchZoom ?? true,
      enableTouchHandles: options.enableTouchHandles ?? true,
      minTouchTarget: options.minTouchTarget ?? 44,
      enableMomentumScroll: options.enableMomentumScroll ?? true,
      enableDoubleTapSelect: options.enableDoubleTapSelect ?? true,
    };
  }

  /**
   * Create ProseMirror plugin
   */
  plugins(): Plugin[] {
    return [
      new Plugin({
        key: new PluginKey('touchHandler'),
        props: {
          handleDOMEvents: {
            touchstart: (view, event) => this.handleTouchStart(view, event as TouchEvent),
            touchmove: (view, event) => this.handleTouchMove(view, event as TouchEvent),
            touchend: (view, event) => this.handleTouchEnd(view, event as TouchEvent),
            touchcancel: (view, event) => this.handleTouchCancel(view, event as TouchEvent),
          },
        },
      }),
    ];
  }

  /**
   * Handle touch start
   */
  private handleTouchStart(view: EditorView, event: TouchEvent): boolean {
    const touch = event.touches[0];
    if (!touch) return false;

    // Initialize touch state
    this.touchState = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      lastX: touch.clientX,
      lastY: touch.clientY,
      isLongPress: false,
      longPressTimer: null,
      touchCount: event.touches.length,
      lastTapTime: this.touchState?.lastTapTime || 0,
    };

    // Prevent pinch zoom
    if (this.options.preventPinchZoom && event.touches.length > 1) {
      event.preventDefault();
      return true;
    }

    // Handle long press
    if (this.options.enableLongPress && event.touches.length === 1) {
      this.touchState.longPressTimer = window.setTimeout(() => {
        this.handleLongPress(view, touch.clientX, touch.clientY);
      }, this.options.longPressDuration);
    }

    // Handle double tap
    if (this.options.enableDoubleTapSelect) {
      const timeSinceLastTap = Date.now() - this.touchState.lastTapTime;
      if (timeSinceLastTap < 300) {
        this.handleDoubleTap(view, touch.clientX, touch.clientY);
        this.cancelLongPress();
        return true;
      }
      this.touchState.lastTapTime = Date.now();
    }

    return false;
  }

  /**
   * Handle touch move
   */
  private handleTouchMove(view: EditorView, event: TouchEvent): boolean {
    if (!this.touchState) return false;

    const touch = event.touches[0];
    if (!touch) return false;

    // Calculate movement
    const deltaX = touch.clientX - this.touchState.startX;
    const deltaY = touch.clientY - this.touchState.startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Cancel long press if moved too much
    if (distance > 10) {
      this.cancelLongPress();
    }

    // Update position
    this.touchState.lastX = touch.clientX;
    this.touchState.lastY = touch.clientY;

    // Update selection handles if visible
    if (this.selectionHandles && !view.state.selection.empty) {
      this.updateSelectionHandles(view);
    }

    return false;
  }

  /**
   * Handle touch end
   */
  private handleTouchEnd(view: EditorView, event: TouchEvent): boolean {
    if (!this.touchState) return false;

    const touch = event.changedTouches[0];
    if (!touch) return false;

    // Cancel long press
    this.cancelLongPress();

    // Handle swipe gesture
    if (this.options.enableSwipe) {
      const deltaX = touch.clientX - this.touchState.startX;
      const deltaY = touch.clientY - this.touchState.startY;
      const duration = Date.now() - this.touchState.startTime;

      if (this.isSwipe(deltaX, deltaY, duration)) {
        const handled = this.handleSwipe(view, deltaX, deltaY);
        if (handled) {
          event.preventDefault();
          this.touchState = null;
          return true;
        }
      }
    }

    // Show selection handles if text is selected
    if (this.options.enableTouchHandles && !view.state.selection.empty) {
      this.showSelectionHandles(view);
    }

    this.touchState = null;
    return false;
  }

  /**
   * Handle touch cancel
   */
  private handleTouchCancel(view: EditorView, event: TouchEvent): boolean {
    this.cancelLongPress();
    this.touchState = null;
    return false;
  }

  /**
   * Check if gesture is a swipe
   */
  private isSwipe(deltaX: number, deltaY: number, duration: number): boolean {
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const velocity = distance / duration;

    return (
      distance > this.options.swipeThreshold &&
      velocity > 0.3 && // pixels per ms
      Math.abs(deltaX) > Math.abs(deltaY) * 2 // horizontal swipe
    );
  }

  /**
   * Handle swipe gesture
   */
  private handleSwipe(view: EditorView, deltaX: number, deltaY: number): boolean {
    const editor = this.getEditorInstance();
    if (!editor) return false;

    // Swipe right = undo
    if (deltaX > 0) {
      if (editor.commands.canExecute('undo')) {
        editor.commands.execute('undo');
        this.announceAction('Undo');
        return true;
      }
    }
    // Swipe left = redo
    else if (deltaX < 0) {
      if (editor.commands.canExecute('redo')) {
        editor.commands.execute('redo');
        this.announceAction('Redo');
        return true;
      }
    }

    return false;
  }

  /**
   * Handle long press
   */
  private handleLongPress(view: EditorView, x: number, y: number): void {
    if (!this.touchState) return;

    this.touchState.isLongPress = true;

    // Show context menu
    const pos = view.posAtCoords({ left: x, top: y });
    if (pos) {
      // Create custom context menu event
      const event = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });

      view.dom.dispatchEvent(event);
      this.announceAction('Context menu opened');
    }
  }

  /**
   * Handle double tap
   */
  private handleDoubleTap(view: EditorView, x: number, y: number): void {
    const pos = view.posAtCoords({ left: x, top: y });
    if (!pos) return;

    // Select word at position
    const { state, dispatch } = view;
    const $pos = state.doc.resolve(pos.pos);

    // Find word boundaries
    let start = pos.pos;
    let end = pos.pos;

    const textBefore = $pos.parent.textContent.substring(0, $pos.parentOffset);
    const textAfter = $pos.parent.textContent.substring($pos.parentOffset);

    const wordBefore = textBefore.match(/\w+$/);
    const wordAfter = textAfter.match(/^\w+/);

    if (wordBefore) {
      start = pos.pos - wordBefore[0].length;
    }
    if (wordAfter) {
      end = pos.pos + wordAfter[0].length;
    }

    if (start !== end) {
      const tr = state.tr.setSelection(TextSelection.between(state.doc.resolve(start), state.doc.resolve(end)));
      dispatch(tr);
      this.announceAction('Word selected');
    }
  }

  /**
   * Cancel long press timer
   */
  private cancelLongPress(): void {
    if (this.touchState?.longPressTimer !== null) {
      clearTimeout(this.touchState.longPressTimer);
      if (this.touchState) {
        this.touchState.longPressTimer = null;
      }
    }
  }

  /**
   * Show selection handles
   */
  private showSelectionHandles(view: EditorView): void {
    if (!this.options.enableTouchHandles) return;

    // Remove existing handles
    this.hideSelectionHandles();

    // Create handles
    const startHandle = document.createElement('div');
    startHandle.className = 'selection-handle selection-handle-start';
    startHandle.setAttribute('role', 'button');
    startHandle.setAttribute('aria-label', 'Selection start handle');

    const endHandle = document.createElement('div');
    endHandle.className = 'selection-handle selection-handle-end';
    endHandle.setAttribute('role', 'button');
    endHandle.setAttribute('aria-label', 'Selection end handle');

    // Add to DOM
    const container = view.dom.closest('.editor-container') || document.body;
    container.appendChild(startHandle);
    container.appendChild(endHandle);

    this.selectionHandles = { start: startHandle, end: endHandle };

    // Position handles
    this.updateSelectionHandles(view);

    // Add touch handlers for dragging
    this.attachHandleListeners(view);
  }

  /**
   * Update selection handle positions
   */
  private updateSelectionHandles(view: EditorView): void {
    if (!this.selectionHandles) return;

    const { from, to } = view.state.selection;

    try {
      const startCoords = view.coordsAtPos(from);
      const endCoords = view.coordsAtPos(to);

      this.selectionHandles.start.style.left = `${startCoords.left}px`;
      this.selectionHandles.start.style.top = `${startCoords.bottom}px`;

      this.selectionHandles.end.style.left = `${endCoords.right}px`;
      this.selectionHandles.end.style.top = `${endCoords.bottom}px`;
    } catch (e) {
      // Position might be invalid, hide handles
      this.hideSelectionHandles();
    }
  }

  /**
   * Hide selection handles
   */
  private hideSelectionHandles(): void {
    if (this.selectionHandles) {
      this.selectionHandles.start.remove();
      this.selectionHandles.end.remove();
      this.selectionHandles = null;
    }
  }

  /**
   * Attach listeners to selection handles
   */
  private attachHandleListeners(view: EditorView): void {
    if (!this.selectionHandles) return;

    const handleDrag = (handle: HTMLElement, isStart: boolean) => {
      let isDragging = false;

      const onTouchStart = (e: TouchEvent) => {
        isDragging = true;
        e.preventDefault();
      };

      const onTouchMove = (e: TouchEvent) => {
        if (!isDragging) return;

        const touch = e.touches[0];
        const pos = view.posAtCoords({ left: touch.clientX, top: touch.clientY });

        if (pos) {
          const { from, to } = view.state.selection;
          const newSelection = isStart
            ? TextSelection.between(view.state.doc.resolve(pos.pos), view.state.doc.resolve(to))
            : TextSelection.between(view.state.doc.resolve(from), view.state.doc.resolve(pos.pos));

          view.dispatch(view.state.tr.setSelection(newSelection));
          this.updateSelectionHandles(view);
        }

        e.preventDefault();
      };

      const onTouchEnd = () => {
        isDragging = false;
      };

      handle.addEventListener('touchstart', onTouchStart);
      handle.addEventListener('touchmove', onTouchMove);
      handle.addEventListener('touchend', onTouchEnd);
    };

    handleDrag(this.selectionHandles.start, true);
    handleDrag(this.selectionHandles.end, false);
  }

  /**
   * Ensure minimum touch target sizes
   */
  private ensureTouchTargets(editor: EditorInstance): void {
    const minSize = this.options.minTouchTarget;

    // Add touch target sizing to buttons
    const style = document.createElement('style');
    style.textContent = `
      @media (pointer: coarse) {
        .toolbar-button,
        .bubble-menu-button,
        .search-button {
          min-width: ${minSize}px;
          min-height: ${minSize}px;
          padding: ${Math.max(8, (minSize - 24) / 2)}px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Announce action to screen readers
   */
  private announceAction(message: string): void {
    const editor = this.getEditorInstance();
    if (editor?.accessibility?.announce) {
      editor.accessibility.announce(message, 'polite');
    }
  }

  /**
   * Get editor instance
   */
  private getEditorInstance(): EditorInstance | null {
    return (this as any).editor || null;
  }

  /**
   * Extension lifecycle: onCreate
   */
  onCreate(editor: EditorInstance): void {
    (this as any).editor = editor;

    // Ensure touch targets are properly sized
    this.ensureTouchTargets(editor);

    // Enable momentum scrolling
    if (this.options.enableMomentumScroll) {
      editor.view.dom.style.webkitOverflowScrolling = 'touch';
    }

    // Hide selection handles on selection change
    editor.signals.selection.subscribe(() => {
      if (editor.view.state.selection.empty) {
        this.hideSelectionHandles();
      }
    });
  }

  /**
   * Extension lifecycle: onDestroy
   */
  onDestroy(): void {
    this.hideSelectionHandles();
    this.cancelLongPress();
    this.touchState = null;
  }
}
