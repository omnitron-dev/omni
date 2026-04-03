/**
 * Prism CLI Constants
 *
 * @module @omnitron-dev/prism/cli/constants
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

/** Current Prism version */
export const PRISM_VERSION = pkg.version;

/** Default configuration file name */
export const CONFIG_FILE_NAME = 'prism.config.json';

/** Default component output directory */
export const DEFAULT_COMPONENTS_DIR = 'src/components/ui';

/** Default blocks output directory */
export const DEFAULT_BLOCKS_DIR = 'src/blocks';

/** Default hooks output directory */
export const DEFAULT_HOOKS_DIR = 'src/hooks';

/** Default utils output directory */
export const DEFAULT_UTILS_DIR = 'src/utils';

/** Default registry URL */
export const DEFAULT_REGISTRY_URL = 'https://registry.prism.omnitron.dev';

/** Default configuration */
export const DEFAULT_CONFIG = {
  $schema: 'https://prism.omnitron.dev/schema.json',
  style: 'default' as const,
  tailwind: {
    config: 'tailwind.config.js',
    css: 'src/index.css',
    baseColor: 'slate',
    cssVariables: true,
  },
  aliases: {
    components: '@/components/ui',
    blocks: '@/blocks',
    hooks: '@/hooks',
    utils: '@/utils',
  },
  registries: [DEFAULT_REGISTRY_URL],
};

/** Detect if colors should be suppressed */
const supportsColor = !process.env.NO_COLOR && process.stderr.isTTY !== false;

/** CLI colors - disabled when NO_COLOR is set or output is not a TTY */
export const COLORS = supportsColor
  ? {
      primary: '\x1b[36m',
      success: '\x1b[32m',
      warning: '\x1b[33m',
      error: '\x1b[31m',
      muted: '\x1b[90m',
      bold: '\x1b[1m',
      reset: '\x1b[0m',
    }
  : {
      primary: '',
      success: '',
      warning: '',
      error: '',
      muted: '',
      bold: '',
      reset: '',
    };

/** Log utilities */
export const log = {
  info: (msg: string) => console.log(`${COLORS.primary}ℹ${COLORS.reset} ${msg}`),
  success: (msg: string) => console.log(`${COLORS.success}✓${COLORS.reset} ${msg}`),
  warning: (msg: string) => console.log(`${COLORS.warning}⚠${COLORS.reset} ${msg}`),
  error: (msg: string) => console.error(`${COLORS.error}✖${COLORS.reset} ${msg}`),
  muted: (msg: string) => console.log(`${COLORS.muted}${msg}${COLORS.reset}`),
};

/** Component categories */
export const COMPONENT_CATEGORIES = [
  'inputs',
  'data-display',
  'feedback',
  'surfaces',
  'navigation',
  'layout',
  'data',
] as const;

/** Block categories */
export const BLOCK_CATEGORIES = ['layouts', 'auth', 'settings', 'data', 'dashboard', 'marketing'] as const;
