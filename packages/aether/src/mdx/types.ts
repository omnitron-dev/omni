/**
 * MDX Types for Aether
 *
 * Core type definitions for the MDX system integrated with Aether
 */

import type { Component } from '../core/component/types.js';
import type { Signal } from '../core/reactivity/types.js';
import type { VNode } from '../reconciler/vnode.js';
import type { JSXElement } from '../jsxruntime/types.js';
import type { CSSProperties } from '../utils/styles.js';

// ============================================================================
// Core MDX Types
// ============================================================================

/**
 * MDX Node representation for AST
 */
export interface MDXNode {
  type: 'element' | 'text' | 'mdxJsxFlowElement' | 'mdxFlowExpression' | 'mdxJsxTextElement' | 'mdxTextExpression';
  value?: string;
  tagName?: string;
  children?: MDXNode[];
  attributes?: MDXAttribute[];
  position?: Position;
  data?: Record<string, any>;
}

/**
 * MDX Attribute
 */
export interface MDXAttribute {
  type: 'mdxJsxAttribute';
  name: string;
  value: string | MDXExpression | boolean;
}

/**
 * MDX Expression
 */
export interface MDXExpression {
  type: 'expression';
  value: string;
  data?: {
    estree?: any; // ESTree AST
  };
}

/**
 * Position information for source mapping
 */
export interface Position {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
}

// ============================================================================
// Compilation Options
// ============================================================================

/**
 * Syntax highlighting options
 */
export interface SyntaxHighlightOptions {
  /** Languages to support */
  languages?: string[];
  /** Theme to use (VS Code themes) */
  theme?: 'dark-plus' | 'light-plus' | 'monokai' | 'github-dark' | 'github-light';
  /** Add line numbers */
  lineNumbers?: boolean;
  /** Highlight specific lines */
  highlightLines?: number[];
  /** Add copy button */
  copyButton?: boolean;
}

/**
 * Compile-time optimization options
 */
export interface CompileTimeOptimizations {
  /** Static extraction optimizations */
  staticExtraction?: {
    hoistStatic?: boolean;
    precompileExpressions?: boolean;
    inlineConstants?: boolean;
  };
  /** Caching options */
  cache?: {
    compiledModules?: boolean;
    astCache?: boolean;
    persistent?: boolean;
  };
  /** Code splitting */
  splitting?: {
    lazyBlocks?: boolean;
    extractShared?: boolean;
  };
  /** General optimizations */
  removeComments?: boolean;
  minify?: boolean;
  treeshake?: boolean;
}

/**
 * MDX compilation options
 */
export interface CompileMDXOptions {
  /** Compilation mode */
  mode?: 'development' | 'production' | 'reactive' | 'fast';

  /** Output format */
  outputFormat?: 'component' | 'vnode' | 'string';

  /** JSX support */
  jsx?: boolean;
  jsxImportSource?: string;

  /** Markdown extensions */
  gfm?: boolean;
  frontmatter?: boolean;
  math?: boolean;
  directives?: boolean;

  /** Code highlighting */
  highlight?: SyntaxHighlightOptions;

  /** Plugins */
  remarkPlugins?: any[];
  rehypePlugins?: any[];
  aetherPlugins?: AetherMDXPlugin[];

  /** Optimizations */
  optimize?: CompileTimeOptimizations;

  /** Security */
  sanitize?: boolean;
  allowedElements?: string[];
  disallowedElements?: string[];

  /** Target platform */
  target?: 'browser' | 'node' | 'universal';

  /** Custom components for MDX rendering */
  components?: MDXComponents;

  /** Global scope variables */
  scope?: Record<string, any>;
}

// ============================================================================
// Component Types
// ============================================================================

/**
 * MDX Component type
 */
export type MDXComponent<P = {}> = Component<P & MDXComponentProps>;

/**
 * MDX Component props
 */
export interface MDXComponentProps {
  /** Children can be MDX content */
  children?: MDXContent;
  /** Support for className and style */
  className?: string;
  style?: CSSProperties;
  /** MDX-specific props */
  mdxType?: string;
  originalType?: string;
  parentName?: string;
}

/**
 * MDX Content type
 */
export type MDXContent =
  | string
  | number
  | boolean
  | null
  | undefined
  | MDXElement
  | MDXContent[];

/**
 * MDX Element
 */
export interface MDXElement {
  $$typeof: symbol;
  type: string | Component;
  props: Record<string, any>;
  key?: string | number;
}

/**
 * Components mapping for MDX
 */
export type MDXComponents = Record<string, Component | ((props: any) => JSXElement)>;

// ============================================================================
// Context Types
// ============================================================================

/**
 * MDX Context value
 */
export interface MDXContextValue {
  /** Component overrides */
  components: MDXComponents;
  /** Global scope variables */
  scope: Record<string, any>;
  /** Reactive scope with signals */
  reactiveScope?: {
    [key: string]: Signal<any> | (() => any);
  };
  /** Error handler */
  onError?: (error: Error) => void;
  /** Navigation handler */
  onNavigate?: (url: string) => void;
}

/**
 * MDX Provider props
 */
export interface MDXProviderProps {
  /** Custom components */
  components?: MDXComponents;
  /** Global data available in MDX */
  scope?: Record<string, any>;
  /** Error handler */
  onError?: (error: Error) => void;
  /** Navigation handler */
  onNavigate?: (url: string) => void;
  /** Children */
  children?: any;
}

// ============================================================================
// Module Types
// ============================================================================

/**
 * Table of contents entry
 */
export interface TOCEntry {
  level: number;
  title: string;
  id: string;
  children?: TOCEntry[];
}

/**
 * MDX Module - result of compilation
 */
export interface MDXModule {
  /** Compiled code */
  code: string;

  /** Default exported component */
  default: MDXComponent;

  /** Frontmatter data */
  frontmatter?: Record<string, any>;

  /** Metadata */
  meta?: {
    title?: string;
    description?: string;
    keywords?: string[];
    author?: string;
    date?: Date;
  };

  /** Table of contents */
  toc?: TOCEntry[];

  /** Used components list */
  usedComponents?: string[];

  /** Source map */
  map?: any;
}

// ============================================================================
// Plugin Types
// ============================================================================

/**
 * Plugin context
 */
export interface PluginContext {
  /** Plugin name */
  name: string;
  /** Compilation options */
  options: CompileMDXOptions;
  /** Add warning */
  warn: (message: string) => void;
  /** Add error */
  error: (message: string) => void;
}

/**
 * Aether MDX Plugin
 */
export interface AetherMDXPlugin {
  /** Plugin name */
  name: string;

  /** Setup hook */
  setup?(context: PluginContext): void | Promise<void>;

  /** Transform MDAST */
  transformMdast?(node: any, file: any): any | null | undefined | Promise<any | null | undefined>;

  /** Transform HAST */
  transformHast?(node: any, file: any): any | null | undefined | Promise<any | null | undefined>;

  /** Transform Aether nodes */
  transformAether?(node: MDXNode): MDXNode | null | undefined | Promise<MDXNode | null | undefined>;

  /** Provide components */
  components?: MDXComponents;

  /** Provide scope */
  scope?: Record<string, any>;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Sanitize options
 */
export interface SanitizeOptions {
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
  allowedProtocols?: string[];
}

/**
 * MDX to HTML options
 */
export interface MDXToHTMLOptions {
  sanitize?: boolean;
  components?: MDXComponents;
}

/**
 * Reading time result
 */
export interface ReadingTime {
  minutes: number;
  words: number;
  time: number;
}

/**
 * Image extraction result
 */
export interface ExtractedImage {
  src: string;
  alt?: string;
  title?: string;
}

/**
 * Link extraction result
 */
export interface ExtractedLink {
  href: string;
  text: string;
  external: boolean;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning';
  }>;
}

// ============================================================================
// Runtime Types
// ============================================================================

/**
 * MDX runtime options
 */
export interface MDXRuntimeOptions {
  /** Enable virtual scrolling */
  virtualScroll?: boolean;
  /** Enable lazy image loading */
  lazyImages?: boolean;
  /** Cache compiled components */
  cacheComponents?: boolean;
  /** Enable debug mode */
  debug?: boolean;
}

/**
 * MDX navigation hook result
 */
export interface MDXNavigationResult {
  toc: TOCEntry[];
  activeSection: Signal<string | null>;
  scrollToSection: (id: string) => void;
}

// Export for convenience
export type { Component, Signal, VNode, JSXElement, CSSProperties };