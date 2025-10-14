/**
 * Icon Management System
 *
 * Centralized exports for icon registry, provider, and utilities
 */

// Export IconRegistry and related types
export {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconDefinition,
  type IconSource,
  type IconSet,
  type IconTransformer,
} from './IconRegistry.js';

// Export IconProvider and hooks
export {
  IconProvider,
  useIcons,
  useIconDefaults,
  useIconFallback,
  useIconContext,
  type IconProviderProps,
  type IconContextValue,
} from './IconProvider.js';

// Export icon set presets and utilities
export {
  loadIconSet,
  createIconSet,
  mergeIconSets,
  filterIconSet,
  transformIconSet,
  getIconSetMetadata,
  validateIconSet,
  iconSets,
  type IconSetConfig,
  type IconSetLoader,
} from './presets/index.js';
