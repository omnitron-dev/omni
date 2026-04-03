'use client';

/**
 * Navigation Item Component
 *
 * Individual navigation item with icon, text, and optional children indicator.
 *
 * @module @omnitron-dev/prism/components/nav-section
 */

import { forwardRef, useMemo } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';

import type { NavItemProps, NavItemRenderProps } from './types.js';
import { NavItemBase, NavIcon, NavTexts, NavArrow, NavInfo } from './components.js';
import { isExternalLink } from '../../utils/url.js';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve icon from render props or direct node.
 */
function resolveIcon(
  icon: string | React.ReactNode | undefined,
  render?: NavItemRenderProps
): React.ReactNode | undefined {
  if (!icon) return undefined;
  if (typeof icon === 'string' && render?.navIcon) {
    return render.navIcon[icon];
  }
  return icon as React.ReactNode;
}

/**
 * Resolve info from render props or direct node.
 */
function resolveInfo(
  info: string[] | React.ReactNode | undefined,
  render?: NavItemRenderProps
): React.ReactNode | undefined {
  if (!info) return undefined;
  if (Array.isArray(info) && render?.navInfo) {
    const infoComponents = info.map((key) => render.navInfo?.(key));
    return (
      <>
        {infoComponents.map((comp, idx) => (
          <Box key={idx} component="span">
            {comp && Object.values(comp)[0]}
          </Box>
        ))}
      </>
    );
  }
  return info as React.ReactNode;
}

// =============================================================================
// NAV ITEM COMPONENT
// =============================================================================

/**
 * NavItem - Individual navigation item.
 *
 * @example
 * ```tsx
 * <NavItem
 *   title="Dashboard"
 *   path="/dashboard"
 *   icon={<DashboardIcon />}
 *   active={pathname === '/dashboard'}
 * />
 * ```
 */
export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(function NavItem(props, ref) {
  const {
    // Data props
    path,
    title,
    icon,
    info,
    caption,
    disabled,
    children,
    // State props
    open,
    active,
    // Options
    depth = 1,
    hasChild,
    externalLink,
    enabledRootRedirect,
    render,
    slotProps,
    // ButtonBase props
    onClick,
    ...other
  } = props;

  // Resolve icon and info from render props
  const resolvedIcon = useMemo(() => resolveIcon(icon, render), [icon, render]);
  const resolvedInfo = useMemo(() => resolveInfo(info, render), [info, render]);

  // Check if external link
  const isExternal = externalLink ?? isExternalLink(path);

  // Determine if item should be clickable
  const isClickable = !disabled && (enabledRootRedirect || !hasChild || depth > 1);

  // Build anchor props for external links
  const linkProps = isExternal
    ? {
        component: 'a' as const,
        href: path,
        target: '_blank',
        rel: 'noopener noreferrer',
      }
    : {};

  const content = (
    <NavItemBase
      ref={ref}
      active={active}
      disabled={disabled}
      open={open}
      depth={depth}
      hasChild={hasChild}
      onClick={isClickable ? onClick : undefined}
      sx={slotProps?.sx}
      {...linkProps}
      {...other}
    >
      <NavIcon icon={resolvedIcon} className={slotProps?.icon as string} />
      <NavTexts title={title} caption={caption} className={slotProps?.texts as string} />
      {resolvedInfo && <NavInfo info={resolvedInfo} className={slotProps?.info as string} />}
      {hasChild && <NavArrow open={open} className={slotProps?.arrow as string} />}
    </NavItemBase>
  );

  // Wrap with tooltip for caption in mini mode or when needed
  if (caption && depth === 1) {
    return (
      <Tooltip title={caption} placement="right" arrow>
        {content}
      </Tooltip>
    );
  }

  return content;
});

// =============================================================================
// NAV ITEM EXPORTS
// =============================================================================

export type { NavItemProps };
