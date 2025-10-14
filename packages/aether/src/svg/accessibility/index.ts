/**
 * SVG Accessibility Module
 *
 * Comprehensive accessibility features for SVG elements
 * following WCAG 2.1 AA guidelines
 */

// Export ARIA support
export {
  createAccessibleSVG,
  makeAccessible,
  resolveValue,
  applyAccessibleProps,
  withARIA,
  ensureUniqueId,
  validateARIA,
  type AccessibleSVGProps,
  type AccessibilityOptions,
} from './aria.js';

// Export screen reader support
export {
  useScreenReaderAnnounce,
  useVerboseDescription,
  createSROnlyText,
  announceToScreenReader,
  generateComplexSVGDescription,
  hideFromScreenReaders,
  showToScreenReaders,
  DebouncedAnnouncer,
  type ScreenReaderConfig,
} from './screen-reader.js';

// Export keyboard navigation
export {
  useSVGKeyboardNavigation,
  makeKeyboardFocusable,
  makeKeyboardAccessible,
  removeKeyboardFocus,
  isKeyboardFocusable,
  type KeyboardNavigationConfig,
  type FocusRingConfig,
} from './keyboard.js';

// Export utilities
export {
  getAccessibleName,
  validateAccessibility,
  generateAccessibilityReport,
  fixCommonA11yIssues,
  isDecorative,
  markAsDecorative,
  unmarkAsDecorative,
  addAccessibleDescription,
  getAccessibilityInfo,
  generateAccessibleTitle,
  generateAccessibleDescription,
  ensureUniqueId as ensureUniqueElementId,
  type AccessibilityIssue,
  type AccessibilityReport,
  type IssueSeverity,
} from './utils.js';
