/**
 * Avatar Primitive
 *
 * Display user avatars with fallback support.
 * Useful for user profiles, comments, team members, etc.
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal } from '../core/reactivity/signal.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export interface AvatarProps {
  /**
   * Children (Image and Fallback)
   */
  children: any;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface AvatarImageProps {
  /**
   * Image source URL
   */
  src: string;

  /**
   * Alt text
   */
  alt: string;

  /**
   * Callback when image loads
   */
  onLoad?: () => void;

  /**
   * Callback when image fails to load
   */
  onError?: () => void;

  /**
   * Additional props
   */
  [key: string]: any;
}

export interface AvatarFallbackProps {
  /**
   * Children (text or icon)
   */
  children?: any;

  /**
   * Delay before showing fallback (ms)
   * @default 0
   */
  delayMs?: number;

  /**
   * Additional props
   */
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface AvatarContextValue {
  imageLoadingStatus: () => 'idle' | 'loading' | 'loaded' | 'error';
  setImageLoadingStatus: (status: 'idle' | 'loading' | 'loaded' | 'error') => void;
}

const noop = () => {};
const noopGetter = () => 'idle' as const;

export const AvatarContext = createContext<AvatarContextValue>(
  {
    imageLoadingStatus: noopGetter,
    setImageLoadingStatus: noop,
  },
  'Avatar'
);

// ============================================================================
// Components
// ============================================================================

/**
 * Avatar root component
 *
 * @example
 * ```tsx
 * <Avatar>
 *   <Avatar.Image src="/avatar.jpg" alt="John Doe" />
 *   <Avatar.Fallback>JD</Avatar.Fallback>
 * </Avatar>
 * ```
 */
export const Avatar = defineComponent<AvatarProps>((props) => {
  const imageLoadingStatus = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');

  const contextValue: AvatarContextValue = {
    imageLoadingStatus: () => imageLoadingStatus(),
    setImageLoadingStatus: (status) => imageLoadingStatus.set(status),
  };

  return () =>
    jsx(AvatarContext.Provider, {
      value: contextValue,
      children: jsx('span', {
        ...props,
        'data-avatar': '',
      }),
    });
});

/**
 * Avatar Image component
 */
export const AvatarImage = defineComponent<AvatarImageProps>((props) => {
  const ctx = useContext(AvatarContext);

  const handleLoad = () => {
    ctx.setImageLoadingStatus('loaded');
    props.onLoad?.();
  };

  const handleError = () => {
    ctx.setImageLoadingStatus('error');
    props.onError?.();
  };

  const handleLoadStart = () => {
    ctx.setImageLoadingStatus('loading');
  };

  return () => {
    const status = ctx.imageLoadingStatus();

    // Don't render if error occurred
    if (status === 'error') {
      return null;
    }

    return jsx('img', {
      ...props,
      'data-avatar-image': '',
      'data-status': status,
      onLoad: handleLoad,
      onError: handleError,
      onLoadStart: handleLoadStart,
      style: {
        ...props.style,
        display: status === 'loaded' ? 'block' : 'none',
      },
    });
  };
});

/**
 * Avatar Fallback component
 */
export const AvatarFallback = defineComponent<AvatarFallbackProps>((props) => {
  const ctx = useContext(AvatarContext);
  const canShowFallback = signal(props.delayMs === undefined || props.delayMs === 0);

  // Handle delay
  if (props.delayMs && props.delayMs > 0) {
    setTimeout(() => {
      canShowFallback.set(true);
    }, props.delayMs);
  }

  return () => {
    const status = ctx.imageLoadingStatus();
    const shouldShow = (status === 'error' || status === 'idle') && canShowFallback();

    if (!shouldShow) {
      return null;
    }

    return jsx('span', {
      ...props,
      'data-avatar-fallback': '',
      'data-status': status,
    });
  };
});
