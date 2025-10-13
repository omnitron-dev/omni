/**
 * Styling System
 *
 * Complete styling solution for Aether with:
 * - CSS-in-JS runtime
 * - Styled component factory
 * - CSS utilities
 */

// Runtime
export {
  createStyleSheet,
  getGlobalSheet,
  injectStyles,
  extractStyles,
  getSSRStyleTags,
  cleanupStyles,
  clearSSRStyles,
  resetStyleIdCounter,
  isServerSide,
  setSSRMode,
  type StyleSheet,
  type StyleRule,
  type InjectStylesOptions,
} from './runtime.js';

// Styled components
export {
  styled,
  styledWithElements,
  createVariant,
  composeStyles,
  type StyledProps,
  type VariantConfig,
  type VariantProps,
  type StyleConfig,
  type CompoundVariant,
  type DefaultVariants,
  type CSSProperties as StyledCSSProperties,
  type ExtractVariantProps,
} from './styled.js';

// CSS utilities
export {
  css,
  cx,
  keyframes,
  globalStyles,
  cssReset,
  responsive,
  darkMode,
  mergeCSS,
  cssVariables,
  type CSSValue,
  type CSSProperties,
  type ClassValue,
  type Keyframe,
} from './css.js';

// Default export
export { styledWithElements as default } from './styled.js';
