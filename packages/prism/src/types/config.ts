/**
 * Configuration Type Definitions
 *
 * @module @omnitron-dev/prism/types/config
 */

import type { ThemeConfig, ThemePreset } from './theme.js';
import type { RegistryConfig } from './registry.js';

/**
 * Style framework options.
 */
export type StyleFramework = 'mui' | 'tailwind' | 'emotion';

/**
 * Paths configuration.
 */
export interface PathsConfig {
  /** Path to components directory */
  components: string;
  /** Path to blocks directory */
  blocks: string;
  /** Path to theme directory */
  themes: string;
  /** Path to utilities directory */
  utils: string;
  /** Path to types directory */
  types: string;
}

/**
 * Style configuration.
 */
export interface StyleConfig {
  /** Style framework */
  framework: StyleFramework;
  /** Enable CSS variables */
  cssVariables: boolean;
  /** CSS variable prefix */
  prefix: string;
}

/**
 * Features configuration.
 */
export interface FeaturesConfig {
  /** Enable dark mode */
  darkMode: boolean;
  /** Enable RTL support */
  rtl: boolean;
  /** Enable i18n support */
  i18n: boolean;
  /** Enable analytics */
  analytics: boolean;
}

/**
 * Prism CLI configuration.
 */
export interface PrismConfig {
  /** Project name */
  name?: string;

  /** Paths configuration */
  paths: PathsConfig;

  /** Registry configuration */
  registries: RegistryConfig;

  /** Theme configuration */
  theme: ThemeConfig;

  /** Style configuration */
  style: StyleConfig;

  /** Features configuration */
  features: FeaturesConfig;

  /** TypeScript enabled */
  typescript: boolean;

  /** Custom aliases */
  aliases?: Record<string, string>;
}

/**
 * Prism config file (prism.config.ts).
 */
export interface PrismConfigFile {
  /** Configuration object or factory function */
  default: PrismConfig | (() => PrismConfig) | (() => Promise<PrismConfig>);
}

/**
 * Default configuration values.
 */
export const defaultPrismConfig: PrismConfig = {
  paths: {
    components: 'src/components/prism',
    blocks: 'src/blocks',
    themes: 'src/theme',
    utils: 'src/lib/prism',
    types: 'src/types/prism',
  },
  registries: {
    default: '@omnitron-dev/prism-registry',
    registries: {},
  },
  theme: {
    preset: 'default' as ThemePreset,
    mode: 'light',
    direction: 'ltr',
    cssVariables: {
      prefix: 'prism',
      colorSchemeSelector: 'data-theme',
      enabled: true,
    },
  },
  style: {
    framework: 'mui',
    cssVariables: true,
    prefix: 'prism',
  },
  features: {
    darkMode: true,
    rtl: false,
    i18n: false,
    analytics: false,
  },
  typescript: true,
};

/**
 * Partial config for user-defined overrides.
 */
export type PartialPrismConfig = DeepPartial<PrismConfig>;

/**
 * Deep partial type helper.
 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Define config helper type.
 */
export type DefineConfigFn = (config: PartialPrismConfig) => PrismConfig;
