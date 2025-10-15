/**
 * Core Module - Theme Service
 *
 * Theme management service for dark/light mode switching
 */

import { Injectable, inject } from '@omnitron-dev/aether/di';
import { signal, computed, type Signal } from '@omnitron-dev/aether';
import { StorageService } from './storage.service';
import { EventBusService } from './event-bus.service';
import { STORAGE_KEYS, THEMES, EVENTS, type Theme } from '../constants';

/**
 * Theme Service
 *
 * Manages application theme (dark/light/auto) with:
 * - Persistent storage
 * - System preference detection
 * - Event emission on theme changes
 * - Reactive theme state
 *
 * @example
 * ```typescript
 * const themeService = inject(ThemeService);
 *
 * // Get current theme
 * const theme = themeService.theme();
 *
 * // Set theme
 * themeService.setTheme('dark');
 *
 * // Toggle theme
 * themeService.toggleTheme();
 *
 * // Check if dark mode
 * if (themeService.isDark()) {
 *   console.log('Dark mode is active');
 * }
 * ```
 */
@Injectable({ scope: 'singleton', providedIn: 'root' })
export class ThemeService {
  private storage = inject(StorageService);
  private eventBus = inject(EventBusService);

  // Reactive state
  private _theme = signal<Theme>(THEMES.DARK);
  private _systemTheme = signal<Exclude<Theme, 'auto'>>(THEMES.DARK);

  /**
   * Current theme (reactive)
   */
  readonly theme: Signal<Theme> = this._theme;

  /**
   * System preference theme (reactive)
   */
  readonly systemTheme: Signal<Exclude<Theme, 'auto'>> = this._systemTheme;

  /**
   * Computed: is dark mode active
   */
  readonly isDark = computed(() => {
    const theme = this._theme();
    if (theme === THEMES.AUTO) {
      return this._systemTheme() === THEMES.DARK;
    }
    return theme === THEMES.DARK;
  });

  /**
   * Computed: is light mode active
   */
  readonly isLight = computed(() => !this.isDark());

  /**
   * Computed: effective theme (resolves 'auto' to dark/light)
   */
  readonly effectiveTheme = computed<Exclude<Theme, 'auto'>>(() => {
    const theme = this._theme();
    if (theme === THEMES.AUTO) {
      return this._systemTheme();
    }
    return theme as Exclude<Theme, 'auto'>;
  });

  constructor() {
    this.initialize();
  }

  /**
   * Initialize theme service
   */
  private initialize(): void {
    // Detect system theme preference
    this.detectSystemTheme();

    // Listen for system theme changes
    this.watchSystemTheme();

    // Load saved theme from storage
    this.loadTheme();

    // Apply theme to DOM
    this.applyTheme();
  }

  /**
   * Detect system theme preference
   */
  private detectSystemTheme(): void {
    if (typeof window === 'undefined') return;

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this._systemTheme.set(prefersDark ? THEMES.DARK : THEMES.LIGHT);
  }

  /**
   * Watch for system theme changes
   */
  private watchSystemTheme(): void {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      this._systemTheme.set(e.matches ? THEMES.DARK : THEMES.LIGHT);

      // If using auto theme, apply the new system theme
      if (this._theme() === THEMES.AUTO) {
        this.applyTheme();
      }
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      // Legacy browsers
      mediaQuery.addListener(handleChange);
    }
  }

  /**
   * Load theme from storage
   */
  private loadTheme(): void {
    const savedTheme = this.storage.get<Theme>(STORAGE_KEYS.THEME);

    if (savedTheme && Object.values(THEMES).includes(savedTheme)) {
      this._theme.set(savedTheme);
    }
  }

  /**
   * Save theme to storage
   */
  private saveTheme(theme: Theme): void {
    this.storage.set(STORAGE_KEYS.THEME, theme);
  }

  /**
   * Apply theme to DOM
   */
  private applyTheme(): void {
    if (typeof document === 'undefined') return;

    const effectiveTheme = this.effectiveTheme();
    const root = document.documentElement;

    // Set data-theme attribute
    root.setAttribute('data-theme', effectiveTheme);

    // Add/remove dark class for compatibility
    if (effectiveTheme === THEMES.DARK) {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }

  /**
   * Set theme
   *
   * @param theme - Theme to set
   */
  setTheme(theme: Theme): void {
    if (!Object.values(THEMES).includes(theme)) {
      console.warn(`[ThemeService] Invalid theme: ${theme}`);
      return;
    }

    const oldTheme = this._theme();
    this._theme.set(theme);
    this.saveTheme(theme);
    this.applyTheme();

    // Emit theme changed event
    this.eventBus.emit(EVENTS.THEME_CHANGED, {
      oldTheme,
      newTheme: theme,
      effectiveTheme: this.effectiveTheme(),
    });
  }

  /**
   * Toggle between dark and light themes
   */
  toggleTheme(): void {
    const currentTheme = this._theme();

    // If auto, toggle to opposite of system theme
    if (currentTheme === THEMES.AUTO) {
      const effectiveTheme = this.effectiveTheme();
      this.setTheme(effectiveTheme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK);
      return;
    }

    // Toggle between dark and light
    this.setTheme(currentTheme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK);
  }

  /**
   * Set auto theme (follow system preference)
   */
  setAutoTheme(): void {
    this.setTheme(THEMES.AUTO);
  }

  /**
   * Get theme as string (for compatibility)
   */
  getTheme(): Theme {
    return this._theme();
  }

  /**
   * Get effective theme as string
   */
  getEffectiveTheme(): Exclude<Theme, 'auto'> {
    return this.effectiveTheme();
  }
}
