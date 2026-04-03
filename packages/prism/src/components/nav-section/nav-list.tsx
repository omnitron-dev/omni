'use client';

/**
 * Navigation List Component
 *
 * Renders a navigation item with its children, handling collapse and active states.
 *
 * @module @omnitron/prism/components/nav-section
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import Collapse from '@mui/material/Collapse';

import type { NavListProps, NavSubListProps, NavItemDataProps } from './types.js';
import { NavUl, NavLi } from './components.js';
import { NavItem } from './nav-item.js';
import { useNavPathname } from './nav-context.js';
import { isActiveLink } from '../../utils/url.js';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if any child route is active.
 */
function hasActiveChild(data: NavItemDataProps, currentPath: string, deepMatch = false): boolean {
  if (!data.children?.length) return false;

  return data.children.some((child) => {
    const childActive = deepMatch ? isActiveLink(currentPath, child.path, true) : currentPath === child.path;

    if (childActive) return true;
    if (child.children?.length) {
      return hasActiveChild(child, currentPath, deepMatch);
    }
    return false;
  });
}

// =============================================================================
// NAV LIST COMPONENT
// =============================================================================

/**
 * NavList - Renders a navigation item with its children.
 *
 * @example
 * ```tsx
 * <NavList
 *   data={{
 *     title: 'Users',
 *     path: '/users',
 *     children: [
 *       { title: 'List', path: '/users/list' },
 *       { title: 'Create', path: '/users/create' },
 *     ],
 *   }}
 *   depth={1}
 * />
 * ```
 */
export function NavList({
  data,
  depth = 1,
  render,
  slotProps,
  cssVars,
  checkPermissions,
  enabledRootRedirect,
}: NavListProps): React.ReactNode {
  const pathname = useNavPathname();

  // Check if this item is active
  const isActive = useMemo(
    () => isActiveLink(pathname, data.path, data.deepMatch),
    [pathname, data.path, data.deepMatch]
  );

  // Check if any child is active
  const hasChild = Boolean(data.children?.length);
  const childActive = useMemo(
    () => hasChild && hasActiveChild(data, pathname, data.deepMatch),
    [data, pathname, hasChild]
  );

  // Open state for collapse (default open if child is active)
  const [open, setOpen] = useState(childActive);

  // Update open state when child becomes active
  useEffect(() => {
    if (childActive) {
      setOpen(true);
    }
  }, [childActive]);

  // Toggle collapse
  const handleToggle = useCallback(() => {
    if (hasChild) {
      setOpen((prev) => !prev);
    }
  }, [hasChild]);

  // Handle navigation click
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (hasChild && !enabledRootRedirect) {
        event.preventDefault();
        handleToggle();
      }
    },
    [hasChild, enabledRootRedirect, handleToggle]
  );

  // Check permissions
  if (checkPermissions && data.allowedRoles) {
    const hasPermission = checkPermissions(data.allowedRoles);
    if (!hasPermission) return null;
  }

  return (
    <NavLi>
      <NavItem
        // Data
        path={data.path}
        title={data.title}
        icon={data.icon}
        info={data.info}
        caption={data.caption}
        disabled={data.disabled}
        // State
        active={isActive || childActive}
        open={open}
        // Options
        depth={depth}
        hasChild={hasChild}
        enabledRootRedirect={enabledRootRedirect}
        render={render}
        slotProps={depth === 1 ? slotProps?.rootItem : slotProps?.subItem}
        // Events
        onClick={handleClick}
      />

      {hasChild && (
        <Collapse in={open} unmountOnExit>
          <NavSubList
            data={data.children!}
            depth={depth + 1}
            render={render}
            slotProps={slotProps}
            checkPermissions={checkPermissions}
            enabledRootRedirect={enabledRootRedirect}
          />
        </Collapse>
      )}
    </NavLi>
  );
}

// =============================================================================
// NAV SUB LIST COMPONENT
// =============================================================================

/**
 * NavSubList - Renders a list of child navigation items.
 */
export function NavSubList({
  data,
  depth,
  render,
  slotProps,
  cssVars,
  checkPermissions,
  enabledRootRedirect,
}: NavSubListProps): React.ReactNode {
  return (
    <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
      {data.map((item) => (
        <NavList
          key={item.title}
          data={item}
          depth={depth}
          render={render}
          slotProps={slotProps}
          cssVars={cssVars}
          checkPermissions={checkPermissions}
          enabledRootRedirect={enabledRootRedirect}
        />
      ))}
    </NavUl>
  );
}
