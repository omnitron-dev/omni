'use client';

/**
 * Mini Navigation Section
 *
 * Compact icon-only navigation for collapsed sidebars.
 *
 * @module @omnitron/prism/components/nav-section
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTheme, styled } from '@mui/material/styles';
import Popover from '@mui/material/Popover';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';

import type { NavItemDataProps, NavListProps, NavSectionProps } from './types.js';
import { Nav, NavUl, NavLi, NavItemBase, NavIcon } from './components.js';
import { NavItem } from './nav-item.js';
import { useNavPathname } from './nav-context.js';
import { navSectionClasses, navSectionCssVars } from './styles.js';
import { cn } from '../../utils/cn.js';
import { isActiveLink } from '../../utils/url.js';

// =============================================================================
// MINI NAV ITEM
// =============================================================================

const MiniNavButton = styled(NavItemBase)(({ theme }) => ({
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  textAlign: 'center',
  padding: 'var(--nav-item-padding, 8px)',
  gap: 4,
}));

const MiniTitle = styled('span')({
  fontSize: 'var(--nav-item-font-size, 0.625rem)',
  fontWeight: 500,
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
});

// =============================================================================
// MINI NAV LIST
// =============================================================================

/**
 * MiniNavList - Navigation item for mini layout with tooltip popover.
 */
function MiniNavList({
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

  // Resolve icon
  const icon = typeof data.icon === 'string' && render?.navIcon ? render.navIcon[data.icon] : data.icon;

  const content = (
    <MiniNavButton
      ref={anchorRef}
      active={isActive || childActive}
      disabled={data.disabled}
      open={open}
      onMouseEnter={handleOpen}
      onMouseLeave={handleClose}
      sx={slotProps?.rootItem?.sx}
    >
      <NavIcon icon={icon} className={slotProps?.rootItem?.icon as string} />
      <MiniTitle>{data.title}</MiniTitle>
    </MiniNavButton>
  );

  return (
    <NavLi>
      {hasChild ? (
        <>
          {content}
          <Popover
            open={open}
            anchorEl={anchorRef.current}
            anchorOrigin={{
              vertical: 'center',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'center',
              horizontal: 'left',
            }}
            slotProps={{
              paper: {
                onMouseEnter: handleOpen,
                onMouseLeave: handleClose,
                sx: {
                  pointerEvents: 'auto',
                  ml: 1,
                  minWidth: 'var(--nav-tooltip-paper-width, 160px)',
                  borderRadius: 1,
                  ...slotProps?.dropdown?.paper,
                },
              },
            }}
            sx={{
              pointerEvents: 'none',
            }}
            disableRestoreFocus
          >
            <MiniDropdown
              data={data.children!}
              render={render}
              slotProps={slotProps}
              checkPermissions={checkPermissions}
              enabledRootRedirect={enabledRootRedirect}
            />
          </Popover>
        </>
      ) : (
        <Tooltip title={data.title} placement="right" arrow>
          {content}
        </Tooltip>
      )}
    </NavLi>
  );
}

// =============================================================================
// MINI DROPDOWN
// =============================================================================

interface MiniDropdownProps {
  data: NavItemDataProps[];
  render?: NavListProps['render'];
  slotProps?: NavListProps['slotProps'];
  checkPermissions?: NavListProps['checkPermissions'];
  enabledRootRedirect?: boolean;
}

/**
 * MiniDropdown - Dropdown content for mini nav items.
 */
function MiniDropdown({
  data,
  render,
  slotProps,
  checkPermissions,
  enabledRootRedirect,
}: MiniDropdownProps): React.ReactNode {
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
// NAV SECTION MINI
// =============================================================================

/**
 * NavSectionMini - Compact navigation for collapsed sidebars.
 *
 * @example
 * ```tsx
 * const navConfig = [
 *   {
 *     items: [
 *       { title: 'Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
 *       {
 *         title: 'Users',
 *         path: '/users',
 *         icon: <UsersIcon />,
 *         children: [
 *           { title: 'List', path: '/users/list' },
 *           { title: 'Create', path: '/users/create' },
 *         ],
 *       },
 *     ],
 *   },
 * ];
 *
 * <NavProvider pathname={pathname}>
 *   <NavSectionMini data={navConfig} />
 * </NavProvider>
 * ```
 */
export function NavSectionMini({
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

  const cssVars = { ...navSectionCssVars.mini(theme), ...overridesVars };

  // Flatten all items from all groups
  const items = useMemo(() => data.flatMap((group) => group.items), [data]);

  return (
    <Nav
      className={cn(navSectionClasses.root, navSectionClasses.mini, className)}
      sx={[
        {
          ...cssVars,
          alignItems: 'center',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <NavUl sx={{ gap: 'var(--nav-item-gap)', alignItems: 'center' }}>
        {items.map((item) => (
          <MiniNavList
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
