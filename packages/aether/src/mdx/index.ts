/**
 * Aether MDX Module
 *
 * Complete MDX solution for Aether Framework with fine-grained reactivity
 */

// ============================================================================
// Compiler exports
// ============================================================================
export {
  // Main compiler functions
  compileMDX,
  compileMDXSync,
  evaluateMDX,
  renderMDX,

  // Compiler classes
  MDXCompiler,
  AetherMDXParser,
  MDXToVNodeTransformer,
  AetherComponentGenerator,

  // Pipeline and transforms
  TransformPipeline,
  ReactiveContentTransform,
} from './compiler/index.js';

// Import for re-use in default export
import { compileMDX, compileMDXSync, evaluateMDX, renderMDX } from './compiler/index.js';

// ============================================================================
// Runtime exports
// ============================================================================
export {
  // Provider and context
  MDXProvider,
  MDXContext,
  useMDXContext,
  createMDXScope,
  withMDXProvider,

  // Error handlers
  defaultMDXErrorHandler,
  defaultMDXNavigateHandler,
} from './runtime/provider.js';

// Import for re-use in default export
import { MDXProvider, useMDXContext } from './runtime/provider.js';

export {
  // MDX Components object
  MDXComponents as MDXComponentsDefault,
  // Individual components
  H1,
  H2,
  H3,
  H4,
  H5,
  H6,
  MDXCodeBlock,
  MDXLink,
  MDXImage,
  MDXTable,
  MDXBlockquote,
  MDXAlert,
  MDXDetails,
} from './runtime/components.js';

// ============================================================================
// Hooks exports
// ============================================================================
export {
  // Compiler hook
  useMDXCompiler,

  // Data hooks
  useFrontmatter,
  useMDXNavigation,
  useSyntaxHighlight,

  // Utility hooks
  useMDXSearch,
  useCopyToClipboard,
  useReadingTime,
  useMDXTheme,
  useLazyMDX,
} from './hooks/index.js';

// ============================================================================
// Utilities exports
// ============================================================================
export {
  // Security
  sanitizeMDX,
  validateMDX,

  // Transformations
  mdxToHTML,
  mdxToPlainText,

  // Content analysis
  calculateReadingTime,
  extractImages,
  extractLinks,
  parseFrontmatter,
  extractTOC,

  // Helpers
  generateId,
  highlightMatches,
  truncateMDX,
} from './utils/index.js';

// Import for re-use in default export
import { sanitizeMDX, validateMDX, mdxToHTML, mdxToPlainText } from './utils/index.js';

// ============================================================================
// Type exports
// ============================================================================
export type {
  // Core types
  MDXNode,
  MDXAttribute,
  MDXExpression,
  Position,

  // Component types
  MDXComponent,
  MDXComponentProps,
  MDXComponents,
  MDXContent,
  MDXElement,

  // Module types
  MDXModule,
  TOCEntry,

  // Context types
  MDXContextValue,
  MDXProviderProps,

  // Compilation options
  CompileMDXOptions,
  SyntaxHighlightOptions,
  CompileTimeOptimizations,

  // Plugin types
  AetherMDXPlugin,
  PluginContext,

  // Utility types
  SanitizeOptions,
  MDXToHTMLOptions,
  ReadingTime,
  ExtractedImage,
  ExtractedLink,
  ValidationResult,

  // Navigation types
  MDXNavigationResult,

  // Runtime options
  MDXRuntimeOptions,
} from './types.js';

// ============================================================================
// Default export
// ============================================================================

/**
 * Aether MDX - Advanced dynamic markdown system
 *
 * Features:
 * - Fine-grained reactivity with signals
 * - Component-based architecture
 * - VS Code quality syntax highlighting
 * - Full JSX support
 * - SSR ready
 * - Plugin system
 * - Type-safe API
 *
 * @example
 * ```typescript
 * import { compileMDX, MDXProvider } from '@omnitron-dev/aether/mdx';
 *
 * // Compile MDX
 * const module = await compileMDX('# Hello MDX\n\n<Button>Click me</Button>');
 *
 * // Render with provider
 * const App = () => (
 *   <MDXProvider components={{ Button }}>
 *     <module.default />
 *   </MDXProvider>
 * );
 * ```
 */
const AetherMDX = {
  // Compiler
  compile: compileMDX,
  compileSync: compileMDXSync,
  evaluate: evaluateMDX,
  render: renderMDX,

  // Runtime
  Provider: MDXProvider,
  useMDXContext,

  // Utils
  sanitize: sanitizeMDX,
  validate: validateMDX,
  toHTML: mdxToHTML,
  toText: mdxToPlainText,
};

export default AetherMDX;

// ============================================================================
// Version and metadata
// ============================================================================

export const VERSION = '0.1.0';
export const MDX_COMPATIBLE_VERSION = '3.0.0';
