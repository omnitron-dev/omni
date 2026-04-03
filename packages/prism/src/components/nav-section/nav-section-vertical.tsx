'use client';

/**
 * Vertical Navigation Section
 *
 * Collapsible navigation groups for sidebar layouts.
 *
 * @module @omnitron/prism/components/nav-section
 */

import { useTheme } from '@mui/material/styles';
import Collapse from '@mui/material/Collapse';

import type { NavGroupProps, NavSectionProps } from './types.js';
import { Nav, NavUl, NavLi, NavSubheader } from './components.js';
import { NavList } from './nav-list.js';
import { navSectionClasses, navSectionCssVars } from './styles.js';
import { cn } from '../../utils/cn.js';
import { useBoolean } from '../../core/index.js';

// =============================================================================
// NAV GROUP COMPONENT
// =============================================================================

/**
 * NavGroup - A collapsible group of navigation items with optional subheader.
 */
function NavGroup({
  items,
  render,
  subheader,
  slotProps,
  checkPermissions,
  enabledRootRedirect,
}: NavGroupProps): React.ReactNode {
  const groupOpen = useBoolean(true);

  const renderContent = () => (
    <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
      {items.map((list) => (
        <NavList
          key={list.title}
          data={list}
          render={render}
          depth={1}
          slotProps={slotProps}
          checkPermissions={checkPermissions}
          enabledRootRedirect={enabledRootRedirect}
        />
      ))}
    </NavUl>
  );

  return (
    <NavLi>
      {subheader ? (
        <>
          <NavSubheader
            data-title={subheader}
            open={groupOpen.value}
            onClick={groupOpen.onToggle}
            sx={slotProps?.subheader}
          >
            {subheader}
          </NavSubheader>

          <Collapse in={groupOpen.value}>{renderContent()}</Collapse>
        </>
      ) : (
        renderContent()
      )}
    </NavLi>
  );
}

// =============================================================================
// NAV SECTION VERTICAL
// =============================================================================

/**
 * NavSectionVertical - Vertical navigation section for sidebar layouts.
 *
 * @example
 * ```tsx
 * const navConfig = [
 *   {
 *     subheader: 'Overview',
 *     items: [
 *       { title: 'Dashboard', path: '/dashboard', icon: <DashboardIcon /> },
 *       { title: 'Analytics', path: '/analytics', icon: <ChartIcon /> },
 *     ],
 *   },
 *   {
 *     subheader: 'Management',
 *     items: [
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
 *   <NavSectionVertical data={navConfig} />
 * </NavProvider>
 * ```
 */
export function NavSectionVertical({
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

  const cssVars = { ...navSectionCssVars.vertical(theme), ...overridesVars };

  return (
    <Nav
      className={cn(navSectionClasses.root, navSectionClasses.vertical, className)}
      sx={[{ ...cssVars }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <NavUl sx={{ flex: '1 1 auto', gap: 'var(--nav-item-gap)' }}>
        {data.map((group) => (
          <NavGroup
            key={group.subheader ?? group.items[0]?.title}
            subheader={group.subheader}
            items={group.items}
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
