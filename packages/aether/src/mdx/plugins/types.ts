/**
 * Plugin Types for Aether MDX
 *
 * Type definitions for the plugin system that allows transforming MDAST, HAST, and Aether AST nodes
 */

import type { MDXNode, MDXComponents, PluginContext, AetherMDXPlugin } from '../types.js';
import type { Component } from '../../core/component/types.js';

// ============================================================================
// Plugin Lifecycle
// ============================================================================

/**
 * Plugin lifecycle phase
 */
export enum PluginPhase {
  /** Setup phase - plugin initialization */
  SETUP = 'setup',
  /** MDAST transformation phase */
  MDAST = 'mdast',
  /** HAST transformation phase */
  HAST = 'hast',
  /** Aether transformation phase */
  AETHER = 'aether',
  /** Cleanup phase */
  CLEANUP = 'cleanup'
}

/**
 * Plugin execution context with state management
 */
export interface PluginExecutionContext extends PluginContext {
  /** Current phase */
  phase: PluginPhase;
  /** Plugin state (shared across transforms) */
  state: Map<string, any>;
  /** File metadata */
  file?: {
    path?: string;
    data?: Record<string, any>;
  };
}

// ============================================================================
// AST Node Types
// ============================================================================

/**
 * MDAST (Markdown AST) node types
 */
export interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  data?: Record<string, any>;
  [key: string]: any;
}

/**
 * HAST (HTML AST) node types
 */
export interface HastNode {
  type: 'element' | 'text' | 'root' | 'comment' | 'doctype';
  tagName?: string;
  properties?: Record<string, any>;
  value?: string;
  children?: HastNode[];
  position?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  data?: Record<string, any>;
}

// ============================================================================
// Plugin Transform Results
// ============================================================================

/**
 * Transform result - can return modified node, null to remove, or undefined to skip
 */
export type TransformResult<T> = T | null | undefined | Promise<T | null | undefined>;

/**
 * Plugin hooks with proper typing
 */
export interface AetherMDXPluginHooks {
  /** Setup hook called once during plugin initialization */
  setup?(context: PluginExecutionContext): void | Promise<void>;

  /** Transform MDAST nodes (Markdown AST) */
  transformMdast?(node: MdastNode, file: any): TransformResult<MdastNode>;

  /** Transform HAST nodes (HTML AST) */
  transformHast?(node: HastNode, file: any): TransformResult<HastNode>;

  /** Transform Aether nodes (final AST before code generation) */
  transformAether?(node: MDXNode): TransformResult<MDXNode>;

  /** Cleanup hook called after compilation */
  cleanup?(context: PluginExecutionContext): void | Promise<void>;
}

// ============================================================================
// Plugin Configuration
// ============================================================================

/**
 * Plugin configuration options
 */
export interface PluginOptions {
  /** Enable/disable plugin */
  enabled?: boolean;
  /** Plugin-specific configuration */
  config?: Record<string, any>;
  /** Priority for execution order (higher = earlier) */
  priority?: number;
}

/**
 * Configured plugin with options
 */
export interface ConfiguredPlugin {
  /** The plugin instance */
  plugin: AetherMDXPlugin;
  /** Plugin configuration */
  options: PluginOptions;
}

// ============================================================================
// Plugin Manager Types
// ============================================================================

/**
 * Plugin registry entry
 */
export interface PluginRegistryEntry {
  /** Plugin instance */
  plugin: AetherMDXPlugin;
  /** Plugin options */
  options: PluginOptions;
  /** Execution context */
  context?: PluginExecutionContext;
  /** Whether plugin has been initialized */
  initialized: boolean;
}

/**
 * Plugin manager configuration
 */
export interface PluginManagerConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Maximum execution time per plugin (ms) */
  timeout?: number;
  /** Continue on plugin errors */
  continueOnError?: boolean;
}

/**
 * Plugin execution result
 */
export interface PluginExecutionResult {
  /** Success status */
  success: boolean;
  /** Plugin name */
  pluginName: string;
  /** Phase executed */
  phase: PluginPhase;
  /** Execution time (ms) */
  executionTime: number;
  /** Error if failed */
  error?: Error;
  /** Result data */
  result?: any;
}

/**
 * Plugin statistics
 */
export interface PluginStats {
  /** Total plugins registered */
  totalPlugins: number;
  /** Plugins by phase */
  pluginsByPhase: Record<PluginPhase, number>;
  /** Total execution time */
  totalExecutionTime: number;
  /** Execution results */
  executions: PluginExecutionResult[];
}

// ============================================================================
// Built-in Plugin Types
// ============================================================================

/**
 * Table plugin configuration
 */
export interface TablePluginConfig {
  /** Enable sorting */
  sortable?: boolean;
  /** Enable filtering */
  filterable?: boolean;
  /** Enable pagination */
  paginated?: boolean;
  /** Default page size */
  pageSize?: number;
  /** Custom sort function */
  sortFn?: (a: any, b: any, column: string) => number;
}

/**
 * Diagram plugin configuration
 */
export interface DiagramPluginConfig {
  /** Diagram type */
  type?: 'mermaid' | 'plantuml' | 'graphviz';
  /** Theme */
  theme?: 'default' | 'dark' | 'forest' | 'neutral';
  /** Custom styles */
  styles?: string;
  /** Enable zoom */
  zoomable?: boolean;
  /** Enable pan */
  pannable?: boolean;
}

/**
 * Embed plugin configuration
 */
export interface EmbedPluginConfig {
  /** Supported platforms */
  platforms?: string[];
  /** Enable autoplay */
  autoplay?: boolean;
  /** Enable controls */
  controls?: boolean;
  /** Default width */
  width?: string | number;
  /** Default height */
  height?: string | number;
  /** Lazy load embeds */
  lazyLoad?: boolean;
  /** Custom providers */
  providers?: Record<string, EmbedProvider>;
}

/**
 * Embed provider configuration
 */
export interface EmbedProvider {
  /** Platform name */
  name: string;
  /** URL pattern to match */
  pattern: RegExp;
  /** Extract embed ID from URL */
  extractId: (url: string) => string | null;
  /** Generate embed URL */
  getEmbedUrl: (id: string, options?: any) => string;
  /** Default dimensions */
  defaultDimensions?: { width: number; height: number };
}

// Re-export core types
export type { AetherMDXPlugin, MDXComponents, PluginContext, MDXNode, Component };
