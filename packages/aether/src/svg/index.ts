/**
 * Aether SVG Module
 *
 * Complete SVG system with primitives, components, animations, and icons
 */

// Export all primitives
export * from './primitives/index.js';

// Export components
export { SVGIcon, type SVGIconProps } from './components/SVGIcon.js';

// Export icon registry
export {
  IconRegistry,
  getIconRegistry,
  resetIconRegistry,
  type IconDefinition,
  type IconSource,
  type IconSet,
  type IconTransformer,
} from './icons/IconRegistry.js';

// Export animation types
export * from './animations/types.js';