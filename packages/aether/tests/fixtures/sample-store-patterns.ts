/**
 * Sample store patterns for integration testing
 *
 * These patterns demonstrate different approaches to store composition
 * with signals, computed values, and effects.
 */

import { signal } from '../../src/core/reactivity/signal.js';
import { computed } from '../../src/core/reactivity/computed.js';

/**
 * Method-based store pattern
 *
 * Store exposes methods that update internal signals.
 * Consumers call methods and read signals directly.
 */
export function createMethodBasedStore() {
  const sidebarComponent = signal<{ focused: boolean; visible?: boolean; width?: number } | null>(
    null,
  );
  const user = signal<{
    preferences?: { darkMode: boolean };
  }>({});

  return {
    // Signal getters
    sidebarComponent,
    user,

    // Methods to update state
    setSidebarFocused(focused: boolean) {
      const current = sidebarComponent();
      sidebarComponent.set({ ...current, focused });
    },

    setSidebarVisible(visible: boolean) {
      const current = sidebarComponent();
      sidebarComponent.set({ ...current, visible });
    },

    setSidebarWidth(width: number) {
      const current = sidebarComponent();
      sidebarComponent.set({ ...current, width });
    },

    setUserPreferences(preferences: { darkMode: boolean }) {
      const current = user();
      user.set({ ...current, preferences });
    },
  };
}

/**
 * Signal-based store pattern
 *
 * Store directly exposes signals for reading and updating.
 * Simple and direct, but less encapsulation.
 */
export function createSignalBasedStore() {
  return {
    sidebarComponent: signal<{
      focused?: boolean;
      visible?: boolean;
      width?: number;
    } | null>(null),
    user: signal<{
      preferences?: { darkMode: boolean };
    }>({}),
  };
}

/**
 * Computed-based store pattern
 *
 * Store uses computed values derived from signals.
 * Good for derived state that depends on multiple sources.
 */
export function createComputedBasedStore() {
  const sidebarFocused = signal(false);
  const sidebarVisible = signal(false);
  const sidebarWidth = signal(300);

  const sidebarComponent = computed(() => ({
    focused: sidebarFocused(),
    visible: sidebarVisible(),
    width: sidebarWidth(),
  }));

  return {
    // Computed getter
    sidebarComponent,

    // Methods to update underlying signals
    setSidebarFocused(focused: boolean) {
      sidebarFocused.set(focused);
    },

    setSidebarVisible(visible: boolean) {
      sidebarVisible.set(visible);
    },

    setSidebarWidth(width: number) {
      sidebarWidth.set(width);
    },
  };
}

/**
 * Complex store with multiple computed values
 *
 * Demonstrates a more realistic store with derived state,
 * computed chains, and multiple update methods.
 */
export function createComplexStore() {
  // Base signals
  const darkMode = signal(false);
  const focused = signal(false);

  // Derived computed values
  const isDarkMode = computed(() => darkMode());
  const isFocused = computed(() => focused());

  // Complex computed depending on multiple sources
  const theme = computed(() => {
    const mode = isDarkMode() ? 'dark' : 'light';
    const state = isFocused() ? 'accent' : 'muted';
    return `${mode}-${state}`;
  });

  return {
    // Computed getters
    theme,
    isDarkMode,
    isFocused,

    // Methods to update state
    toggleDarkMode() {
      darkMode.set(!darkMode());
    },

    toggleFocus() {
      focused.set(!focused());
    },

    setDarkMode(value: boolean) {
      darkMode.set(value);
    },

    setFocus(value: boolean) {
      focused.set(value);
    },
  };
}
