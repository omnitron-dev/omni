import { signal, computed } from '../../src/index.js';

/**
 * Method-based store pattern
 * Store exposes methods that internally use signals
 */
export function createMethodBasedStore() {
  const sidebarSignal = signal(undefined);
  const userSignal = signal({});
  
  return {
    sidebarComponent: () => sidebarSignal(),
    user: () => userSignal(),
    
    setSidebarFocused: (focused) => {
      const current = sidebarSignal() || {};
      sidebarSignal.set({ ...current, focused });
    },
    
    setSidebarComponent: (component) => {
      sidebarSignal.set(component);
    },
    
    setUserPreferences: (preferences) => {
      const current = userSignal() || {};
      userSignal.set({ ...current, preferences });
    }
  };
}

/**
 * Signal-based store pattern
 * Store directly exposes signals
 */
export function createSignalBasedStore() {
  return {
    sidebarComponent: signal(undefined),
    user: signal({}),
    theme: signal('light')
  };
}

/**
 * Computed-based store pattern
 * Store uses computed values for derived state
 */
export function createComputedBasedStore() {
  const sidebarSignal = signal(undefined);
  const userSignal = signal({});
  
  const sidebarComponent = computed(() => sidebarSignal());
  const user = computed(() => userSignal());
  
  return {
    sidebarComponent,
    user,
    
    setSidebarFocused: (focused) => {
      const current = sidebarSignal() || {};
      sidebarSignal.set({ ...current, focused });
    },
    
    setUserPreferences: (preferences) => {
      const current = userSignal() || {};
      userSignal.set({ ...current, preferences });
    }
  };
}

/**
 * Complex store with multiple computed values
 * Demonstrates chained computeds and complex logic
 */
export function createComplexStore() {
  const sidebarSignal = signal({ focused: false, visible: true, width: 300 });
  const userSignal = signal({ preferences: { darkMode: false, notifications: true } });
  
  // Computed values
  const isDarkMode = computed(() => userSignal().preferences?.darkMode || false);
  const isFocused = computed(() => sidebarSignal().focused || false);
  
  // Computed that depends on other computeds
  const theme = computed(() => {
    const dark = isDarkMode();
    const focused = isFocused();
    
    if (dark && focused) return 'dark-accent';
    if (dark) return 'dark-muted';
    if (focused) return 'light-accent';
    return 'light-muted';
  });
  
  return {
    // Exposed computeds
    theme,
    isDarkMode,
    isFocused,
    
    // Actions
    toggleDarkMode: () => {
      const current = userSignal();
      userSignal.set({
        ...current,
        preferences: {
          ...current.preferences,
          darkMode: !current.preferences?.darkMode
        }
      });
    },
    
    toggleFocus: () => {
      const current = sidebarSignal();
      sidebarSignal.set({
        ...current,
        focused: !current.focused
      });
    }
  };
}