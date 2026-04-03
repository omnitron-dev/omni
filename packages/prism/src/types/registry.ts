/**
 * Registry Type Definitions
 *
 * @module @omnitron/prism/types/registry
 */

import type { BlockDefinition } from './blocks.js';
import type { ThemePresetDefinition } from './theme.js';

/**
 * Component file type.
 */
export type ComponentFileType = 'component' | 'types' | 'styles' | 'barrel' | 'test';

/**
 * Component file definition.
 */
export interface ComponentFile {
  /** File path */
  path: string;
  /** File type */
  type: ComponentFileType;
  /** Content hash for comparison (SHA-256 truncated) */
  hash?: string;
  /** Template identifier (for code generation) */
  template?: string;
}

/**
 * Component dependencies.
 */
export interface ComponentDependencies {
  /** npm packages */
  npm: string[];
  /** Other components */
  components: string[];
}

/**
 * Component definition in registry.
 */
export interface ComponentDefinition {
  /** Component name */
  name: string;
  /** Component version */
  version: string;
  /** Component category */
  category: string;
  /** Display name */
  displayName: string;
  /** Description */
  description: string;
  /** Component files */
  files: ComponentFile[];
  /** Dependencies */
  dependencies: ComponentDependencies;
  /** Whether component has variants */
  hasVariants: boolean;
  /** Preview image URL */
  preview?: string;
  /** Documentation URL */
  docs?: string;
}

/**
 * Theme definition in registry.
 */
export interface ThemeRegistryEntry {
  /** Theme preset name */
  name: string;
  /** Theme file path */
  path: string;
  /** Theme definition */
  definition: ThemePresetDefinition;
}

/**
 * Registry schema.
 */
export interface RegistrySchema {
  /** Schema version */
  $schema?: string;
  /** Registry name */
  name: string;
  /** Registry version */
  version: string;
  /** Registry description */
  description?: string;
  /** Base URL for registry */
  baseUrl?: string;
  /** Extends another registry */
  extends?: string;
  /** Component definitions */
  components: Record<string, ComponentDefinition>;
  /** Block definitions */
  blocks: Record<string, BlockDefinition>;
  /** Theme definitions */
  themes: Record<string, ThemeRegistryEntry>;
}

/**
 * Remote registry configuration.
 */
export interface RemoteRegistryConfig {
  /** Registry URL */
  url: string;
  /** Authentication headers */
  headers?: Record<string, string>;
  /** Cache TTL in seconds */
  cacheTtl?: number;
}

/**
 * Registry configuration.
 */
export interface RegistryConfig {
  /** Default registry */
  default: string;
  /** Additional registries */
  registries: Record<string, string | RemoteRegistryConfig>;
}

/**
 * Installed component tracking.
 */
export interface InstalledComponent {
  /** Component name */
  name: string;
  /** Installed version */
  version: string;
  /** Registry source */
  registry: string;
  /** Installation date */
  installedAt: string;
  /** File paths */
  files: string[];
}

/**
 * Installed block tracking.
 */
export interface InstalledBlock {
  /** Block name */
  name: string;
  /** Installed version */
  version: string;
  /** Registry source */
  registry: string;
  /** Installation date */
  installedAt: string;
  /** File paths */
  files: string[];
  /** Configuration */
  config?: Record<string, unknown>;
}

/**
 * Prism lockfile for tracking installations.
 */
export interface PrismLockfile {
  /** Lockfile version */
  version: string;
  /** Installed components */
  components: Record<string, InstalledComponent>;
  /** Installed blocks */
  blocks: Record<string, InstalledBlock>;
  /** Installed themes */
  themes: string[];
}
