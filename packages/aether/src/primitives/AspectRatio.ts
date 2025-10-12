/**
 * AspectRatio Primitive
 *
 * Maintains a consistent aspect ratio for content.
 * Useful for images, videos, embeds, etc.
 */

import { defineComponent } from '../core/component/define.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface AspectRatioProps {
  /**
   * Aspect ratio (width / height)
   * Common ratios:
   * - 16/9 (widescreen video)
   * - 4/3 (standard video)
   * - 1/1 (square)
   * - 3/2 (photography)
   * - 21/9 (ultrawide)
   */
  ratio: number;

  /**
   * Children
   */
  children?: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Component
// ============================================================================

/**
 * AspectRatio component
 *
 * Wraps content in a container that maintains aspect ratio.
 * Uses padding-bottom trick for responsive aspect ratios.
 *
 * @example
 * ```tsx
 * // 16:9 video
 * <AspectRatio ratio={16/9}>
 *   <video src="/video.mp4" />
 * </AspectRatio>
 *
 * // Square image
 * <AspectRatio ratio={1}>
 *   <img src="/image.jpg" alt="..." />
 * </AspectRatio>
 *
 * // 4:3 standard
 * <AspectRatio ratio={4/3}>
 *   <iframe src="..." />
 * </AspectRatio>
 * ```
 */
export const AspectRatio = defineComponent<AspectRatioProps>((props) => () => {
  const { ratio, children, style, ...restProps } = props;

  // Calculate padding-bottom percentage
  const paddingBottom = `${(1 / ratio) * 100}%`;

  return jsx('div', {
    ...restProps,
    'data-aspect-ratio': '',
    style: {
      position: 'relative',
      width: '100%',
      ...style,
    },
    children: [
      // Padding element to maintain aspect ratio
      jsx('div', {
        style: {
          paddingBottom,
        },
      }),
      // Content container (absolute positioned)
      jsx('div', {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        },
        children,
      }),
    ],
  });
});
