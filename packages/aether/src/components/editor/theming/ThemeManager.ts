/**
 * Theme Manager
 * Manages theme registration, switching, and CSS custom property application
 */

import { createSignal } from '../../../core/reactivity/signal';
import type {
  Theme,
  ThemeConfig,
  ThemeChangeEvent,
  CSSCustomProperties,
  ThemeValidationResult,
  ContrastCheckResult,
} from './types';

/**
 * Default theme configuration
 */
const DEFAULT_CONFIG: ThemeConfig = {
  defaultTheme: 'default',
  autoDarkMode: true,
  persist: true,
  storageKey: 'aether-editor-theme',
  enableTransitions: true,
  transitionDuration: 200,
};

/**
 * Theme Manager class
 * Handles theme registration, switching, and CSS custom property management
 */
export class ThemeManager {
  private themes: Map<string, Theme> = new Map();
  private config: ThemeConfig;
  private rootElement: HTMLElement;
  private styleElement: HTMLStyleElement | null = null;
  private darkModeMediaQuery: MediaQueryList | null = null;

  // Signals for reactive theme state
  private currentThemeSignal = createSignal<string | null>(null);
  private isTransitioningSignal = createSignal<boolean>(false);

  // Event listeners
  private listeners: Set<(event: ThemeChangeEvent) => void> = new Set();

  constructor(config: Partial<ThemeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rootElement = document.documentElement;

    // Initialize style element for CSS custom properties
    this.initializeStyleElement();

    // Set up dark mode detection if enabled
    if (this.config.autoDarkMode) {
      this.setupDarkModeDetection();
    }

    // Load persisted theme if enabled
    if (this.config.persist) {
      this.loadPersistedTheme();
    }
  }

  /**
   * Get current theme name
   */
  get currentTheme(): string | null {
    return this.currentThemeSignal[0]();
  }

  /**
   * Get current theme signal (reactive)
   */
  get currentTheme$() {
    return this.currentThemeSignal[0];
  }

  /**
   * Check if theme is transitioning
   */
  get isTransitioning(): boolean {
    return this.isTransitioningSignal[0]();
  }

  /**
   * Register a new theme
   */
  registerTheme(theme: Theme): void {
    const validation = this.validateTheme(theme);
    if (!validation.valid) {
      throw new Error(
        `Invalid theme: ${validation.errors.join(', ')}`
      );
    }

    this.themes.set(theme.metadata.name, theme);

    // If this is the first theme, apply it
    if (this.themes.size === 1 && !this.currentTheme) {
      this.applyTheme(theme.metadata.name);
    }
  }

  /**
   * Register multiple themes
   */
  registerThemes(themes: Theme[]): void {
    const hadThemes = this.themes.size > 0;
    themes.forEach((theme, index) => {
      const validation = this.validateTheme(theme);
      if (!validation.valid) {
        throw new Error(
          `Invalid theme: ${validation.errors.join(', ')}`
        );
      }
      this.themes.set(theme.metadata.name, theme);
    });

    // Apply initial theme after all are registered (synchronously to avoid timing issues in tests)
    if (!hadThemes && !this.currentTheme) {
      if (this.config.autoDarkMode && this.darkModeMediaQuery) {
        this.switchThemeMode(this.darkModeMediaQuery.matches);
      } else if (themes.length > 0) {
        // Apply theme without awaiting to maintain sync behavior
        this.applyTheme(themes[0].metadata.name);
      }
    }
  }

  /**
   * Get a theme by name
   */
  getTheme(name: string): Theme | undefined {
    return this.themes.get(name);
  }

  /**
   * Get all registered themes
   */
  getAllThemes(): Theme[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get theme names
   */
  getThemeNames(): string[] {
    return Array.from(this.themes.keys());
  }

  /**
   * Apply a theme
   */
  async applyTheme(name: string): Promise<void> {
    const theme = this.themes.get(name);
    if (!theme) {
      throw new Error(`Theme "${name}" not found`);
    }

    const previousTheme = this.currentTheme;

    // Only use transitions when switching between themes (not on initial load)
    const useTransitions = this.config.enableTransitions && previousTheme !== null;

    // Start transition
    if (useTransitions) {
      this.isTransitioningSignal[1](true);
      this.rootElement.classList.add('theme-transitioning');
    }

    // Convert theme to CSS custom properties
    const cssVars = this.themeToCSSVariables(theme);

    // Apply CSS custom properties
    this.applyCSSVariables(cssVars);

    // Update theme class
    this.updateThemeClass(theme.metadata.name);

    // Update current theme
    this.currentThemeSignal[1](theme.metadata.name);

    // Persist if enabled
    if (this.config.persist) {
      this.persistTheme(theme.metadata.name);
    }

    // Wait for transition
    if (useTransitions) {
      await this.waitForTransition();
      this.isTransitioningSignal[1](false);
      this.rootElement.classList.remove('theme-transitioning');
    }

    // Emit change event
    this.emitThemeChange({
      from: previousTheme,
      to: theme.metadata.name,
      theme,
      timestamp: Date.now(),
    });
  }

  /**
   * Switch to dark or light theme based on preference
   */
  switchThemeMode(isDark: boolean): void {
    const themes = this.getAllThemes();
    const targetTheme = themes.find(t => t.metadata.isDark === isDark);

    if (targetTheme) {
      this.applyTheme(targetTheme.metadata.name);
    }
  }

  /**
   * Toggle between dark and light mode
   */
  toggleDarkMode(): void {
    const currentTheme = this.getCurrentThemeObject();
    if (currentTheme) {
      this.switchThemeMode(!currentTheme.metadata.isDark);
    }
  }

  /**
   * Get current theme object
   */
  getCurrentThemeObject(): Theme | null {
    return this.currentTheme ? this.themes.get(this.currentTheme) || null : null;
  }

  /**
   * Add theme change listener
   */
  onThemeChange(listener: (event: ThemeChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Validate a theme
   */
  validateTheme(theme: Theme): ThemeValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check metadata
    if (!theme.metadata?.name) {
      errors.push('Theme must have a name');
    }
    if (!theme.metadata?.version) {
      warnings.push('Theme should have a version');
    }

    // Check colors
    if (!theme.colors?.primary) {
      errors.push('Theme must define primary color');
    }
    if (!theme.colors?.background) {
      errors.push('Theme must define background color');
    }
    if (!theme.colors?.text) {
      errors.push('Theme must define text color');
    }

    // Check contrast
    if (theme.colors?.background && theme.colors?.text) {
      const contrast = this.calculateContrast(
        theme.colors.background,
        theme.colors.text
      );
      if (contrast.ratio < 4.5) {
        errors.push(
          `Insufficient contrast ratio (${contrast.ratio.toFixed(2)}:1) for body text`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Calculate contrast ratio between two colors
   */
  calculateContrast(color1: string, color2: string): ContrastCheckResult {
    const lum1 = this.getLuminance(color1);
    const lum2 = this.getLuminance(color2);

    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);
    const ratio = (lighter + 0.05) / (darker + 0.05);

    return {
      ratio,
      passes: {
        aa: ratio >= 4.5,
        aaa: ratio >= 7,
        aaLarge: ratio >= 3,
        aaaLarge: ratio >= 4.5,
      },
    };
  }

  /**
   * Initialize style element for CSS custom properties
   */
  private initializeStyleElement(): void {
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'aether-theme-vars';
    document.head.appendChild(this.styleElement);
  }

  /**
   * Convert theme to CSS custom properties
   */
  private themeToCSSVariables(theme: Theme): CSSCustomProperties {
    const vars: CSSCustomProperties = {};

    // Colors
    Object.entries(theme.colors).forEach(([key, value]) => {
      vars[`--editor-color-${this.kebabCase(key)}`] = value;
    });

    // Typography
    Object.entries(theme.typography).forEach(([key, value]) => {
      vars[`--editor-${this.kebabCase(key)}`] = value;
    });

    // Spacing
    Object.entries(theme.spacing).forEach(([key, value]) => {
      vars[`--editor-spacing-${key}`] = value;
    });

    // Border radius
    Object.entries(theme.borderRadius).forEach(([key, value]) => {
      vars[`--editor-radius-${key}`] = value;
    });

    // Shadows
    Object.entries(theme.shadows).forEach(([key, value]) => {
      vars[`--editor-shadow-${key}`] = value;
    });

    // Z-index
    Object.entries(theme.zIndex).forEach(([key, value]) => {
      vars[`--editor-z-${this.kebabCase(key)}`] = value;
    });

    // Animation
    Object.entries(theme.animation).forEach(([key, value]) => {
      vars[`--editor-${this.kebabCase(key)}`] = value;
    });

    // Breakpoints
    Object.entries(theme.breakpoints).forEach(([key, value]) => {
      vars[`--editor-breakpoint-${key}`] = value;
    });

    return vars;
  }

  /**
   * Apply CSS custom properties to the document
   */
  private applyCSSVariables(vars: CSSCustomProperties): void {
    const cssText = `:root {\n${Object.entries(vars)
      .map(([key, value]) => `  ${key}: ${value};`)
      .join('\n')}\n}`;

    if (this.styleElement) {
      this.styleElement.textContent = cssText;
    }
  }

  /**
   * Update theme class on root element
   */
  private updateThemeClass(themeName: string): void {
    // Remove existing theme classes
    this.rootElement.classList.forEach(className => {
      if (className.startsWith('theme-')) {
        this.rootElement.classList.remove(className);
      }
    });

    // Add new theme class
    this.rootElement.classList.add(`theme-${themeName}`);
  }

  /**
   * Wait for transition to complete
   */
  private waitForTransition(): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, this.config.transitionDuration);
    });
  }

  /**
   * Persist theme to storage
   */
  private persistTheme(themeName: string): void {
    try {
      localStorage.setItem(this.config.storageKey, themeName);
    } catch (error) {
      console.warn('Failed to persist theme:', error);
    }
  }

  /**
   * Load persisted theme from storage
   */
  private loadPersistedTheme(): void {
    try {
      const themeName = localStorage.getItem(this.config.storageKey);
      if (themeName && this.themes.has(themeName)) {
        this.applyTheme(themeName);
      } else if (this.config.defaultTheme && this.themes.has(this.config.defaultTheme)) {
        // Only apply default theme if it's registered
        this.applyTheme(this.config.defaultTheme);
      }
    } catch (error) {
      console.warn('Failed to load persisted theme:', error);
      if (this.config.defaultTheme && this.themes.has(this.config.defaultTheme)) {
        // Only apply default theme if it's registered
        this.applyTheme(this.config.defaultTheme);
      }
    }
  }

  /**
   * Set up dark mode detection
   */
  private setupDarkModeDetection(): void {
    if (typeof window === 'undefined') return;

    this.darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleDarkModeChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (!this.currentTheme) {
        this.switchThemeMode(e.matches);
      }
    };

    // Initial check
    handleDarkModeChange(this.darkModeMediaQuery);

    // Listen for changes
    this.darkModeMediaQuery.addEventListener('change', handleDarkModeChange);
  }

  /**
   * Emit theme change event
   */
  private emitThemeChange(event: ThemeChangeEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Theme change listener error:', error);
      }
    });
  }

  /**
   * Get luminance of a color
   */
  private getLuminance(color: string): number {
    const rgb = this.parseColor(color);
    if (!rgb) return 0;

    const [r, g, b] = rgb.map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /**
   * Parse color string to RGB values
   */
  private parseColor(color: string): [number, number, number] | null {
    // Handle hex colors
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return [r, g, b];
      } else if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return [r, g, b];
      }
    }

    // Handle rgb/rgba colors
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
      return [
        parseInt(rgbMatch[1], 10),
        parseInt(rgbMatch[2], 10),
        parseInt(rgbMatch[3], 10),
      ];
    }

    return null;
  }

  /**
   * Convert camelCase to kebab-case
   */
  private kebabCase(str: string): string {
    return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  }

  /**
   * Destroy theme manager
   */
  destroy(): void {
    // Remove style element
    if (this.styleElement) {
      this.styleElement.remove();
      this.styleElement = null;
    }

    // Remove dark mode listener
    if (this.darkModeMediaQuery) {
      this.darkModeMediaQuery.removeEventListener('change', () => {});
    }

    // Clear listeners
    this.listeners.clear();

    // Clear themes
    this.themes.clear();
  }
}

/**
 * Global theme manager instance
 */
let globalThemeManager: ThemeManager | null = null;

/**
 * Get or create global theme manager
 */
export function getThemeManager(config?: Partial<ThemeConfig>): ThemeManager {
  if (!globalThemeManager) {
    globalThemeManager = new ThemeManager(config);
  }
  return globalThemeManager;
}

/**
 * Reset global theme manager
 */
export function resetThemeManager(): void {
  if (globalThemeManager) {
    globalThemeManager.destroy();
    globalThemeManager = null;
  }
}
