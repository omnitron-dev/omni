/**
 * Router - Link Component
 *
 * Navigation component with prefetching and active states
 */

import { defineComponent } from '../core/component/define.js';
import { computed } from '../core/reactivity/computed.js';
import { signal } from '../core/reactivity/signal.js';
import { onMount } from '../core/component/lifecycle.js';
import { jsx } from '../jsxruntime/runtime.js';
import { useRouter } from './hooks.js';
import { normalizePath } from './route-matcher.js';
import { prefetchRoute } from './prefetch.js';
import type { NavigationOptions } from './types.js';

/**
 * Link props
 */
export interface LinkProps {
  /** Target path */
  href: string;
  /** Class to apply when route is active */
  activeClass?: string;
  /** Class to apply when route is exactly active */
  exactActiveClass?: string;
  /** Prefetch strategy: boolean, 'hover', 'viewport', or 'render' */
  prefetch?: boolean | 'hover' | 'viewport' | 'render';
  /** Use history.replace instead of push */
  replace?: boolean;
  /** Scroll to top on navigation */
  scroll?: boolean;
  /** State to pass to route */
  state?: any;
  /** Treat as external link (skip router) */
  external?: boolean;
  /** Children */
  children?: any;
  /** Additional class names */
  class?: string;
  /** Additional attributes */
  [key: string]: any;
}

/**
 * Link component for navigation
 *
 * @example
 * ```typescript
 * import { Link } from '@omnitron-dev/aether/router';
 *
 * // Basic link
 * Link({ href: '/about', children: 'About' })
 *
 * // With active class
 * Link({ href: '/users/123', activeClass: 'active', children: 'User Profile' })
 *
 * // With prefetch
 * Link({ href: '/blog', prefetch: true, children: 'Blog' })
 * ```
 */
export const Link = defineComponent<LinkProps>((props) => {
  const router = useRouter();
  const isHovering = signal(false);

  // Check if link is active (prefix matching with boundary check)
  const isActive = computed(() => {
    if (!props.href || props.external) return false;
    const currentPath = normalizePath(router.current.pathname);
    const linkPath = normalizePath(props.href);

    // Exact match or prefix match with path boundary
    if (currentPath === linkPath) return true;
    if (linkPath === '/') return currentPath === '/'; // Root only matches exactly

    // Check if current path starts with link path and next char is '/' or end
    return currentPath.startsWith(linkPath + '/');
  });

  // Check if link is exactly active
  const isExactActive = computed(() => {
    if (!props.href || props.external) return false;
    const currentPath = normalizePath(router.current.pathname);
    const linkPath = normalizePath(props.href);
    return currentPath === linkPath;
  });

  // Compute final class names
  const className = computed(() => {
    const classes: string[] = [];

    if (props.class) {
      classes.push(props.class);
    }

    if (isActive() && props.activeClass) {
      classes.push(props.activeClass);
    }

    if (isExactActive() && props.exactActiveClass) {
      classes.push(props.exactActiveClass);
    }

    return classes.join(' ');
  });

  // Handle click
  const handleClick = (e: MouseEvent) => {
    // Allow default behavior for external links
    if (props.external) return;

    // Allow default for modified clicks (ctrl, cmd, etc)
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

    // Allow default for middle button
    if (e.button !== 0) return;

    // Prevent default navigation
    e.preventDefault();

    // Navigate using router
    const options: NavigationOptions = {
      replace: props.replace,
      scroll: props.scroll !== false,
      state: props.state,
    };

    router.navigate(props.href, options);
  };

  // Handle prefetch on hover
  const handleMouseEnter = () => {
    isHovering.set(true);

    if ((props.prefetch === true || props.prefetch === 'hover') && props.href && !props.external) {
      // Prefetch on hover - non-blocking
      prefetchRoute(router, props.href).catch((err) => {
        console.warn('Hover prefetch failed:', err);
      });
    }
  };

  const handleMouseLeave = () => {
    isHovering.set(false);
  };

  // Prefetch on render if requested
  if (props.prefetch === 'render' && props.href && !props.external) {
    onMount(() => {
      // Prefetch immediately on component mount
      prefetchRoute(router, props.href).catch((err) => {
        console.warn('Render prefetch failed:', err);
      });
    });
  }

  // Render function
  return () => {
    const {
      href,
      activeClass,
      exactActiveClass,
      prefetch,
      replace,
      scroll,
      state,
      external,
      class: _class,
      children,
      ...rest
    } = props;

    const linkProps: any = {
      ...rest,
      href,
      class: className(),
      onClick: handleClick,
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    };

    // For external links, add target and rel
    if (external) {
      linkProps.target = '_blank';
      linkProps.rel = 'noopener noreferrer';
    }

    // Create link element using jsx runtime
    return jsx('a', { ...linkProps, children });
  };
}, 'Link');
