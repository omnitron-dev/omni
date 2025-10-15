/**
 * Core Module - Application Constants
 *
 * Central location for all application-wide constants
 */

/**
 * Application metadata
 */
export const APP_NAME = 'Omnitron';
export const APP_VERSION = '0.1.0';
export const APP_DESCRIPTION = 'The Meta-System for Fractal Computing';

/**
 * Local storage keys
 */
export const STORAGE_KEYS = {
  THEME: 'omnitron:theme',
  USER_PREFERENCES: 'omnitron:user:preferences',
  LAYOUT_STATE: 'omnitron:layout:state',
  RECENT_FILES: 'omnitron:recent:files',
  WORKSPACE: 'omnitron:workspace',
} as const;

/**
 * Theme constants
 */
export const THEMES = {
  DARK: 'dark',
  LIGHT: 'light',
  AUTO: 'auto',
} as const;

export type Theme = (typeof THEMES)[keyof typeof THEMES];

/**
 * Event names for cross-module communication
 */
export const EVENTS = {
  // Theme events
  THEME_CHANGED: 'theme:changed',

  // Navigation events
  ROUTE_CHANGED: 'route:changed',
  ROUTE_ERROR: 'route:error',

  // Application lifecycle events
  APP_READY: 'app:ready',
  APP_ERROR: 'app:error',
  APP_INITIALIZED: 'app:initialized',

  // User events
  USER_LOGGED_IN: 'user:logged-in',
  USER_LOGGED_OUT: 'user:logged-out',
  USER_PREFERENCES_CHANGED: 'user:preferences:changed',
} as const;

/**
 * Default user preferences
 */
export const DEFAULT_USER_PREFERENCES = {
  theme: THEMES.DARK,
  fontSize: 14,
  fontFamily: 'JetBrains Mono, monospace',
  lineHeight: 1.5,
  tabSize: 2,
  autoSave: true,
  autoSaveDelay: 1000,
} as const;
