'use client';

/**
 * Vision Mode Accessibility System
 *
 * Simulates color vision deficiencies to help designers and developers
 * test their applications for accessibility. Uses SVG color matrix filters
 * applied globally to simulate how users with different types of color
 * blindness perceive content.
 *
 * Vision Deficiency Types:
 * - Protanopia: Red-blind (affects ~1% of males)
 * - Deuteranopia: Green-blind (affects ~1% of males)
 * - Tritanopia: Blue-blind (rare, affects <0.01% of population)
 * - Achromatopsia: Complete color blindness (grayscale)
 *
 * @module @omnitron/prism/accessibility
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Available vision modes for color blindness simulation.
 */
export type VisionMode = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

/**
 * Vision mode metadata for UI display.
 */
export interface VisionModeOption {
  /** Mode identifier */
  value: VisionMode;
  /** Human-readable label */
  label: string;
  /** Description of the vision deficiency */
  description: string;
  /** Percentage of population affected (for educational purposes) */
  prevalence?: string;
}

/**
 * Vision mode context value.
 */
export interface VisionModeContextValue {
  /** Current vision mode */
  mode: VisionMode;
  /** Set the vision mode */
  setMode: (mode: VisionMode) => void;
  /** Toggle between normal and a specific mode */
  toggle: (mode?: VisionMode) => void;
  /** Reset to normal vision */
  reset: () => void;
  /** Whether vision filters are active */
  isFiltered: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const STORAGE_KEY = 'prism-vision-mode';
const FILTER_CONTAINER_ID = 'prism-vision-filters';

/**
 * Available vision mode options with descriptions.
 */
export const VISION_MODE_OPTIONS: VisionModeOption[] = [
  {
    value: 'normal',
    label: 'Normal Vision',
    description: 'Shows all colors normally',
  },
  {
    value: 'protanopia',
    label: 'Protanopia',
    description: 'Difficulty distinguishing red from green (red-blind)',
    prevalence: '~1% of males',
  },
  {
    value: 'deuteranopia',
    label: 'Deuteranopia',
    description: 'Difficulty distinguishing green from red (green-blind)',
    prevalence: '~1% of males',
  },
  {
    value: 'tritanopia',
    label: 'Tritanopia',
    description: 'Difficulty distinguishing blue from yellow (blue-blind)',
    prevalence: '<0.01%',
  },
  {
    value: 'achromatopsia',
    label: 'Achromatopsia',
    description: 'Complete color blindness (grayscale only)',
    prevalence: '~0.003%',
  },
];

// =============================================================================
// SVG FILTERS
// =============================================================================

/**
 * Color matrix values for vision deficiency simulation.
 * These matrices transform colors to simulate how they appear to people
 * with various types of color blindness.
 */
const FILTER_MATRICES = {
  // Protanopia: Reduced sensitivity to red light
  protanopia: `
    0.10889 0.89111 0.00000 0 0
    0.10889 0.89111 0.00000 0 0
    0.00447 -0.00447 1.00000 0 0
    0 0 0 1 0
  `,
  // Deuteranopia: Reduced sensitivity to green light
  deuteranopia: `
    0.4251 0.6934 -0.1147 0 0
    0.3417 0.5882 0.0692 0 0
    -0.0105 0.0234 0.9870 0 0
    0 0 0 1 0
  `,
  // Tritanopia: Reduced sensitivity to blue light
  tritanopia: `
    0.95 0.05 0 0 0
    0 0.433 0.567 0 0
    0 0.475 0.525 0 0
    0 0 0 1 0
  `,
  // Achromatopsia: Complete color blindness (luminance only)
  achromatopsia: `
    0.299 0.587 0.114 0 0
    0.299 0.587 0.114 0 0
    0.299 0.587 0.114 0 0
    0 0 0 1 0
  `,
} as const;

/**
 * SVG filters for vision mode simulation.
 * Rendered as a hidden element and referenced by CSS.
 */
function VisionFilters(): ReactNode {
  return (
    <div
      id={FILTER_CONTAINER_ID}
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          {Object.entries(FILTER_MATRICES).map(([mode, matrix]) => (
            <filter key={mode} id={`${mode}-filter`}>
              <feColorMatrix type="matrix" in="SourceGraphic" values={matrix} />
            </filter>
          ))}
        </defs>
      </svg>
    </div>
  );
}

// =============================================================================
// CONTEXT
// =============================================================================

const VisionModeContext = createContext<VisionModeContextValue | null>(null);

// =============================================================================
// PROVIDER
// =============================================================================

/**
 * Props for VisionModeProvider.
 */
export interface VisionModeProviderProps extends PropsWithChildren {
  /** Initial vision mode (default: 'normal' or from localStorage) */
  defaultMode?: VisionMode;
  /** Storage key for persistence (default: 'prism-vision-mode') */
  storageKey?: string;
  /** Disable persistence to localStorage */
  disablePersistence?: boolean;
  /** CSS selector attribute name (default: 'data-vision') */
  attributeName?: string;
}

/**
 * VisionModeProvider - Provides vision mode context and renders filters.
 *
 * @example
 * ```tsx
 * // In your app root
 * import { VisionModeProvider } from '@omnitron/prism/accessibility';
 *
 * function App() {
 *   return (
 *     <VisionModeProvider>
 *       <YourApp />
 *     </VisionModeProvider>
 *   );
 * }
 *
 * // In a component
 * import { useVisionMode, VISION_MODE_OPTIONS } from '@omnitron/prism/accessibility';
 *
 * function AccessibilityPanel() {
 *   const { mode, setMode } = useVisionMode();
 *
 *   return (
 *     <select value={mode} onChange={(e) => setMode(e.target.value as VisionMode)}>
 *       {VISION_MODE_OPTIONS.map((option) => (
 *         <option key={option.value} value={option.value}>
 *           {option.label}
 *         </option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */
export function VisionModeProvider({
  children,
  defaultMode,
  storageKey = STORAGE_KEY,
  disablePersistence = false,
  attributeName = 'data-vision',
}: VisionModeProviderProps): ReactNode {
  // Initialize from localStorage or default
  const [mode, setModeState] = useState<VisionMode>(() => {
    if (typeof window === 'undefined') return defaultMode ?? 'normal';
    if (disablePersistence) return defaultMode ?? 'normal';

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as VisionMode;
        if (VISION_MODE_OPTIONS.some((opt) => opt.value === parsed)) {
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return defaultMode ?? 'normal';
  });

  const [needsFilters, setNeedsFilters] = useState(false);

  // Check if filters need to be rendered
  useEffect(() => {
    if (typeof document !== 'undefined' && !document.getElementById(FILTER_CONTAINER_ID)) {
      setNeedsFilters(true);
    }
  }, []);

  // Apply data attribute to document element
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    if (mode === 'normal') {
      document.documentElement.removeAttribute(attributeName);
    } else {
      document.documentElement.setAttribute(attributeName, mode);
    }

    return () => {
      document.documentElement.removeAttribute(attributeName);
    };
  }, [mode, attributeName]);

  // Persist to localStorage
  useEffect(() => {
    if (disablePersistence || typeof localStorage === 'undefined') return undefined;

    try {
      localStorage.setItem(storageKey, JSON.stringify(mode));
    } catch {
      // Ignore localStorage errors
    }
    return undefined;
  }, [mode, storageKey, disablePersistence]);

  // Cross-tab sync via storage event
  useEffect(() => {
    if (disablePersistence || typeof window === 'undefined') return undefined;

    const handleStorage = (e: StorageEvent) => {
      if (e.key !== storageKey || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue) as VisionMode;
        if (VISION_MODE_OPTIONS.some((opt) => opt.value === parsed)) {
          setModeState(parsed);
        }
      } catch {
        // Ignore parse errors
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [storageKey, disablePersistence]);

  const setMode = useCallback((newMode: VisionMode) => {
    setModeState(newMode);
  }, []);

  const toggle = useCallback((targetMode: VisionMode = 'protanopia') => {
    setModeState((current) => (current === 'normal' ? targetMode : 'normal'));
  }, []);

  const reset = useCallback(() => {
    setModeState('normal');
  }, []);

  const value: VisionModeContextValue = {
    mode,
    setMode,
    toggle,
    reset,
    isFiltered: mode !== 'normal',
  };

  return (
    <VisionModeContext.Provider value={value}>
      {needsFilters && typeof document !== 'undefined' && document.body
        ? createPortal(<VisionFilters />, document.body)
        : null}
      {children}
    </VisionModeContext.Provider>
  );
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * useVisionMode - Hook to access vision mode context.
 *
 * @throws Error if used outside of VisionModeProvider
 *
 * @example
 * ```tsx
 * function AccessibilityToggle() {
 *   const { mode, setMode, isFiltered, reset } = useVisionMode();
 *
 *   return (
 *     <div>
 *       <p>Current mode: {mode}</p>
 *       <button onClick={() => setMode('protanopia')}>
 *         Simulate Protanopia
 *       </button>
 *       {isFiltered && (
 *         <button onClick={reset}>Reset to Normal</button>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 */
export function useVisionMode(): VisionModeContextValue {
  const context = useContext(VisionModeContext);

  if (!context) {
    throw new Error('useVisionMode must be used within a VisionModeProvider');
  }

  return context;
}

// =============================================================================
// CSS STYLES HELPER
// =============================================================================

/**
 * Generate CSS styles for vision mode filters.
 * Use this in your theme's CssBaseline or global styles.
 *
 * @param attributeName - The data attribute name (default: 'data-vision')
 * @returns CSS styles object for MUI CssBaseline styleOverrides
 *
 * @example
 * ```tsx
 * // In your theme configuration
 * import { getVisionModeStyles } from '@omnitron/prism/accessibility';
 *
 * const theme = createTheme({
 *   components: {
 *     MuiCssBaseline: {
 *       styleOverrides: (theme) => ({
 *         ...getVisionModeStyles(),
 *         // ... other styles
 *       }),
 *     },
 *   },
 * });
 * ```
 */
export function getVisionModeStyles(attributeName = 'data-vision'): Record<string, { filter: string }> {
  const modes: Array<Exclude<VisionMode, 'normal'>> = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];

  return Object.fromEntries(
    modes.map((mode) => [`html[${attributeName}="${mode}"]:not([data-showcase])`, { filter: `url("#${mode}-filter")` }])
  ) as Record<string, { filter: string }>;
}
