/**
 * SVG Components
 *
 * High-level SVG components for common use cases
 */

export { SVGIcon, type SVGIconProps } from './SVGIcon.js';
export { AnimatedSVG, type AnimatedSVGProps, type AnimationTrigger } from './AnimatedSVG.js';
export { SVGSprite, SpriteIcon, useSpriteIcon, type SVGSpriteProps, type SpriteIconProps, type CacheConfig } from './SVGSprite.js';
export {
  ProgressiveSVG,
  NoScriptSVG,
  SSRSafeSVG,
  type ProgressiveSVGProps,
  type EnhancementTrigger,
} from './ProgressiveSVG.js';
