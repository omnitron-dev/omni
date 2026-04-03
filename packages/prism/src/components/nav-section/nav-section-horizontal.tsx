'use client';

/**
 * Horizontal Navigation Section
 *
 * Horizontal navigation for header/top bar layouts.
 *
 * @module @omnitron/prism/components/nav-section
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTheme } from '@mui/material/styles';
import Popover from '@mui/material/Popover';
import Paper from '@mui/material/Paper';

import type { NavItemDataProps, NavListProps, NavSectionProps } from './types.js';
import { Nav, NavUl, NavLi } from './components.js';
import { NavItem } from './nav-item.js';
import { useNavPathname } from './nav-context.js';
import { navSectionClasses, navSectionCssVars } from './styles.js';
import { cn } from '../../utils/cn.js';
import { isActiveLink } from '../../utils/url.js';

// =============================================================================
// HORIZONTAL NAV LIST
// =============================================================================

/**
 * HorizontalNavList - Navigation item with dropdown for horizontal layout.
 */
function HorizontalNavList({
  data,
  render,
  slotProps,
  checkPermissions,
  enabledRootRedirect,
}: NavListProps): React.ReactNode {
  const pathname = useNavPathname();
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Check if this item is active
  const isActive = useMemo(
    () => isActiveLink(pathname, data.path, data.deepMatch),
    [pathname, data.path, data.deepMatch]
  );

  // Check if any child is active
  const hasChild = Boolean(data.children?.length);
  const childActive = useMemo(() => {
    if (!hasChild) return false;
    return data.children!.some((child) => isActiveLink(pathname, child.path, child.deepMatch));
  }, [data.children, pathname, hasChild]);

  // Popover state
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    if (hasChild) {
      setOpen(true);
    }
  }, [hasChild]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  // Close on route change
  useEffect(() => {
    handleClose();
  }, [pathname, handleClose]);

  // Check permissions
  if (checkPermissions && data.allowedRoles) {
    const hasPermission = checkPermissions(data.allowedRoles);
    if (!hasPermission) return null;
  }

  return (
    <NavLi>
      <NavItem
        ref={anchorRef}
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
        depth={1}
        hasChild={hasChild}
        enabledRootRedirect={enabledRootRedirect}
        render={render}
        slotProps={slotProps?.rootItem}
        // Events
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      />

      {hasChild && (
        <Popover
          open={open}
          anchorEl={anchorRef.current}
          anchorOrigin={{
            vertical: 'bottom',
            horizontal: 'left',
          }}
          transformOrigin={{
            vertical: 'top',
            horizontal: 'left',
          }}
          slotProps={{
            paper: {
              onMouseEnter: handleOpen,
              onMouseLeave: handleClose,
              sx: {
                pointerEvents: 'auto',
                minWidth: 'var(--nav-dropdown-paper-width, 180px)',
                borderRadius: 'var(--nav-dropdown-paper-radius, 8px)',
                boxShadow: 'var(--nav-dropdown-paper-shadow)',
                ...slotProps?.dropdown?.paper,
              },
            },
          }}
          sx={{
            pointerEvents: 'none',
          }}
          disableRestoreFocus
        >
          <HorizontalDropdown
            data={data.children!}
            render={render}
            slotProps={slotProps}
            checkPermissions={checkPermissions}
            enabledRootRedirect={enabledRootRedirect}
          />
        </Popover>
      )}
    </NavLi>
  );
}

// =============================================================================
// HORIZONTAL DROPDOWN
// =============================================================================

interface HorizontalDropdownProps {
  data: NavItemDataProps[];
  render?: NavListProps['render'];
  slotProps?: NavListProps['slotProps'];
  checkPermissions?: NavListProps['checkPermissions'];
  enabledRootRedirect?: boolean;
}

/**
 * HorizontalDropdown - Dropdown content for horizontal nav items.
 */
function HorizontalDropdown({
  data,
  render,
  slotProps,
  checkPermissions,
  enabledRootRedirect,
}: HorizontalDropdownProps): React.ReactNode {
  const pathname = useNavPathname();

  return (
    <Paper elevation={0} sx={{ p: 1 }}>
      <NavUl sx={{ gap: 0.5 }}>
        {data.map((item) => {
          // Check permissions
          if (checkPermissions && item.allowedRoles) {
            const hasPermission = checkPermissions(item.allowedRoles);
            if (!hasPermission) return null;
          }

          const isActive = isActiveLink(pathname, item.path, item.deepMatch);

          return (
            <NavLi key={item.title}>
              <NavItem
                path={item.path}
                title={item.title}
                icon={item.icon}
                disabled={item.disabled}
                active={isActive}
                depth={2}
                render={render}
                slotProps={slotProps?.subItem}
                enabledRootRedirect={enabledRootRedirect}
              />
            </NavLi>
          );
        })}
      </NavUl>
    </Paper>
  );
}

// =============================================================================
// NAV SECTION HORIZONTAL
// =============================================================================

/**
 * NavSectionHorizontal - Horizontal navigation section for header layouts.
 *
 * @example
 * ```tsx
 * const navConfig = [
 *   {
 *     items: [
 *       { title: 'Home', path: '/', icon: <HomeIcon /> },
 *       {
 *         title: 'Products',
 *         path: '/products',
 *         children: [
 *           { title: 'All', path: '/products' },
 *           { title: 'New', path: '/products/new' },
 *         ],
 *       },
 *     ],
 *   },
 * ];
 *
 * <NavProvider pathname={pathname}>
 *   <NavSectionHorizontal data={navConfig} />
 * </NavProvider>
 * ```
 */
export function NavSectionHorizontal({
  sx,
  data,
  render,
  className,
  slotProps,
  checkPermissions,
  enabledRootRedirect,
  cssVars: overridesVars,
  ...other
}: NavSectionProps): React.ReactNode {
  const theme = useTheme();

  const cssVars = { ...navSectionCssVars.horizontal(theme), ...overridesVars };

  // Flatten all items from all groups
  const items = useMemo(() => data.flatMap((group) => group.items), [data]);

  return (
    <Nav
      className={cn(navSectionClasses.root, navSectionClasses.horizontal, className)}
      sx={[{ ...cssVars }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <NavUl sx={{ flexDirection: 'row', gap: 'var(--nav-item-gap)' }}>
        {items.map((item) => (
          <HorizontalNavList
            key={item.title}
            data={item}
            render={render}
            slotProps={slotProps}
            checkPermissions={checkPermissions}
            enabledRootRedirect={enabledRootRedirect}
          />
        ))}
      </NavUl>
    </Nav>
  );
}
