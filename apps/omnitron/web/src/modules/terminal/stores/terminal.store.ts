/**
 * Terminal Store
 *
 * Reactive state for terminal module
 */

import { defineStore, signal, computed, readonly } from '@omnitron-dev/aether/store';

/**
 * Terminal Store
 *
 * Manages terminal state including visibility, settings, and active session.
 *
 * @example
 * ```typescript
 * const terminalStore = useTerminalStore();
 *
 * // Toggle terminal visibility
 * terminalStore.toggle();
 *
 * // Set font size
 * terminalStore.setFontSize(16);
 *
 * // Set active session
 * terminalStore.setActiveSession('session-1');
 * ```
 */
export const useTerminalStore = defineStore('terminal', () => {
  // State signals
  const isVisible = signal(false);
  const fontSize = signal(14);
  const cursorStyle = signal<'block' | 'underline' | 'line'>('block');
  const scrollback = signal(1000);
  const activeSessionId = signal<string | null>(null);

  // Computed values
  const hasActiveSession = computed(() => activeSessionId() !== null);

  const state = computed(() => ({
    isVisible: isVisible(),
    fontSize: fontSize(),
    cursorStyle: cursorStyle(),
    scrollback: scrollback(),
    activeSessionId: activeSessionId(),
  }));

  // Actions

  /**
   * Show terminal
   */
  const show = () => {
    isVisible.set(true);
  };

  /**
   * Hide terminal
   */
  const hide = () => {
    isVisible.set(false);
  };

  /**
   * Toggle terminal visibility
   */
  const toggle = () => {
    isVisible.set(!isVisible());
  };

  /**
   * Set font size
   */
  const setFontSize = (size: number) => {
    fontSize.set(size);
  };

  /**
   * Set cursor style
   */
  const setCursorStyle = (style: 'block' | 'underline' | 'line') => {
    cursorStyle.set(style);
  };

  /**
   * Set active session
   */
  const setActiveSession = (sessionId: string | null) => {
    activeSessionId.set(sessionId);
  };

  /**
   * Set scrollback size
   */
  const setScrollback = (lines: number) => {
    scrollback.set(lines);
  };

  /**
   * Reset store
   */
  const reset = () => {
    isVisible.set(false);
    fontSize.set(14);
    cursorStyle.set('block');
    scrollback.set(1000);
    activeSessionId.set(null);
  };

  return {
    // State (readonly)
    isVisible: readonly(isVisible),
    fontSize: readonly(fontSize),
    cursorStyle: readonly(cursorStyle),
    scrollback: readonly(scrollback),
    activeSessionId: readonly(activeSessionId),

    // Computed
    hasActiveSession,
    state,

    // Actions
    show,
    hide,
    toggle,
    setFontSize,
    setCursorStyle,
    setActiveSession,
    setScrollback,
    reset,
  };
});
