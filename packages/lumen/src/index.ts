/**
 * @omnitron-dev/lumen
 * Static site generator, Corpus Graph verification engine, and CLI platform.
 */

// 1. Configuration Subsystem
export {
  defineLumenConfig,
  loadLumenConfig,
  resolveConfigFile,
  expandEnvVariables,
  LumenUserConfigSchema,
  LumenThemeConfigSchema,
  LumenPdfConfigSchema,
  LumenLocalesConfigSchema,
  LumenSidebarItemSchema,
  LumenSidebarDocItemSchema,
  LumenSidebarLinkItemSchema,
  LumenSidebarCategoryItemSchema,
} from './config/index.js';
export type { LumenConfig, LumenUserConfig, LumenSidebarItem, LumenPageLayoutProps } from './config/index.js';

// 2. Corpus Knowledge Graph Subsystem
export {
  CorpusGraph,
  isAccessAllowedForRoles,
  isDocumentAllowed,
  projectDocumentAst,
  projectCorpusDocument,
  projectCorpus,
  extractAstPlainText,
  extractFirstParagraphSummary,
} from './corpus/index.js';
export type {
  CorpusDocument,
  CorpusMathObject,
  CorpusHeader,
  CorpusDocumentRelations,
  MathEnvType,
  AnchorResolutionResult,
  LinkResolutionResult,
  OutdatedTranslation,
  CorpusProjectionOptions,
} from './corpus/index.js';

// 3. Verification Gates Framework Subsystem
export {
  defineCorpusGate,
  runCorpusGates,
  linksGate,
  anchorsGate,
  codeDefaultsGate,
  codeExamplesGate,
  undocumentedExportsGate,
  mathKernelGate,
} from './gates/index.js';
export type {
  GateContext,
  GateResult,
  CorpusGate,
  LumenGateDiagnostic,
  GatePipelineSummary,
  RunGatesOptions,
} from './gates/index.js';

// 4. SSG & HTML SSR Subsystem
export {
  buildStaticSite,
  renderDocumentHtml,
  extractCriticalEmotionCss,
  BASE_LUMEN_THEME_CSS,
  buildHtmlPage,
  escapeHtml,
} from './ssg/index.js';
export type {
  SsgBuildOptions,
  SsgBuildResult,
  HtmlPageOptions,
  RenderDocumentHtmlOptions,
  EmotionExtractionResult,
} from './ssg/index.js';

// 5. AI Agent Endpoints Subsystem
export { generateLlmsTxt, generateLlmsFullTxt, generateRouteMirrors, runLumenMcpServer } from './ai/index.js';

// 6. Search Index & Asset Manifest Subsystems
export { tokenizeMultilingual, generateSearchIndex, buildSearchIndex } from './search/index.js';
export type { SearchIndexEntry, SearchIndexResult } from './search/index.js';

export {
  AssetManifestSchema,
  AssetManifestEntrySchema,
  generateAssetManifest,
  carryPreviousBuildForward,
  computeContentHash,
  computeSriHash,
} from './manifest/index.js';
export type { AssetManifest, AssetManifestEntry, GenerateAssetManifestOptions } from './manifest/index.js';

// 7. CLI Entrypoint
export { runLumenCli, loadCorpusFromDirectory } from './cli/index.js';
