'use client';

/**
 * Mobile Mega Menu
 *
 * Accordion-style navigation for mobile layouts.
 *
 * @module @omnitron/prism/components/mega-menu
 */

import { useState, useCallback, useMemo } from 'react';
import Box from '@mui/material/Box';
import { useNavPathname } from '../nav-section/nav-context.js';
import Link from '@mui/material/Link';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled, useTheme, type Theme } from '@mui/material/styles';

import type { MegaMenuProps, MegaMenuListProps } from './types.js';
import { megaMenuClasses, megaMenuCssVars } from './styles.js';
import { cn } from '../../utils/cn.js';
import { isActiveLink, isExternalLink } from '../../utils/url.js';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const Nav = styled('nav')({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  width: '100%',
});

const NavUl = styled('ul')({
  display: 'flex',
  flexDirection: 'column',
  listStyle: 'none',
  padding: 0,
  margin: 0,
  width: '100%',
});

const NavLi = styled('li')({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
});

const navItemStyles = (theme: Theme, active?: boolean) => ({
  all: 'unset' as const,
  boxSizing: 'border-box' as const,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: 'var(--nav-item-padding)',
  minHeight: 'var(--nav-item-min-height)',
  fontSize: 'var(--nav-item-font-size)',
  fontWeight: 500,
  color: 'var(--nav-item-color)',
  borderBottom: `1px solid ${theme.palette.divider}`,
  transition: theme.transitions.create(['background-color', 'color'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&:hover': {
    backgroundColor: 'var(--nav-item-hover-bg)',
    color: 'var(--nav-item-hover-color)',
  },
  ...(active && {
    color: 'var(--nav-item-active-color)',
  }),
});

const NavButton = styled('button')<{ active?: boolean; open?: boolean }>(({ theme, active }) => ({
  ...navItemStyles(theme, active),
  '&:disabled': {
    color: 'var(--nav-item-disabled-color)',
    cursor: 'not-allowed',
  },
}));

const NavLink = styled('a')<{ active?: boolean }>(({ theme, active }) => navItemStyles(theme, active));

const IconWrapper = styled('span')({
  width: 'var(--nav-icon-size)',
  height: 'var(--nav-icon-size)',
  marginRight: 12,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--nav-icon-color)',
  '& svg': {
    width: '100%',
    height: '100%',
  },
});

const ArrowIcon = styled('span')<{ open?: boolean }>(({ open }) => ({
  marginLeft: 'auto',
  width: 20,
  height: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'transform 0.2s',
  transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
  '&::before': {
    content: '""',
    width: 6,
    height: 6,
    borderStyle: 'solid',
    borderWidth: '0 0 2px 2px',
    borderColor: 'currentColor',
    transform: 'rotate(-45deg)',
  },
}));

const CollapseContent = styled(Box)(({ theme }) => ({
  padding: '8px 0',
  paddingLeft: 40,
  backgroundColor: theme.palette.background.neutral,
}));

const SectionHeader = styled(Typography)(({ theme }) => ({
  fontSize: 'var(--nav-subheader-font-size)',
  fontWeight: 'var(--nav-subheader-font-weight)',
  color: theme.palette.text.disabled,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '12px 16px 8px',
}));

const SubItemLink = styled(Link, {
  shouldForwardProp: (prop) => prop !== 'active',
})<{ active?: boolean }>(({ theme, active }) => ({
  display: 'block',
  padding: '10px 16px',
  fontSize: '0.875rem',
  color: active ? theme.palette.primary.main : theme.palette.text.secondary,
  textDecoration: 'none',
  transition: theme.transitions.create('color', {
    duration: theme.transitions.duration.shorter,
  }),
  '&:hover': {
    color: theme.palette.text.primary,
  },
}));

// =============================================================================
// MEGA MENU LIST
// =============================================================================

function MegaMenuList({ data, render, slotProps, enabledRootRedirect }: MegaMenuListProps): React.ReactNode {
  const pathname = useNavPathname();

  const isActive = useMemo(
    () => isActiveLink(pathname, data.path, data.deepMatch),
    [pathname, data.path, data.deepMatch]
  );

  const hasChild = Boolean(data.children?.length);

  const childActive = useMemo(() => {
    if (!data.children?.length) return false;
    return data.children.some((section) => section.items.some((item) => isActiveLink(pathname, item.path)));
  }, [data.children, pathname]);

  // Start open if child is active
  const [open, setOpen] = useState(childActive);

  const handleToggle = useCallback(() => {
    if (hasChild) {
      setOpen((prev) => !prev);
    }
  }, [hasChild]);

  // Resolve icon
  const icon = typeof data.icon === 'string' && render?.navIcon ? render.navIcon[data.icon] : data.icon;

  // Simple link for items without children
  if (!hasChild) {
    const isExternal = isExternalLink(data.path);
    return (
      <NavLi className={megaMenuClasses.li}>
        <NavLink
          href={data.path}
          className={cn(megaMenuClasses.item, isActive && megaMenuClasses.active)}
          active={isActive}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
        >
          {icon && <IconWrapper className={megaMenuClasses.icon}>{icon}</IconWrapper>}
          <span className={megaMenuClasses.title}>{data.title}</span>
        </NavLink>
      </NavLi>
    );
  }

  return (
    <NavLi className={megaMenuClasses.li}>
      <NavButton
        className={cn(
          megaMenuClasses.item,
          (isActive || childActive) && megaMenuClasses.active,
          open && megaMenuClasses.open
        )}
        active={isActive || childActive}
        open={open}
        disabled={data.disabled}
        onClick={handleToggle}
      >
        {icon && <IconWrapper className={megaMenuClasses.icon}>{icon}</IconWrapper>}
        <span className={megaMenuClasses.title}>{data.title}</span>
        <ArrowIcon open={open} className={megaMenuClasses.arrow} />
      </NavButton>

      <Collapse in={open} unmountOnExit>
        <CollapseContent>
          {data.children?.map((section, idx) => (
            <Box key={section.subheader ?? idx}>
              {section.subheader && (
                <SectionHeader className={megaMenuClasses.subheader}>{section.subheader}</SectionHeader>
              )}
              <Stack>
                {section.items.map((item) => {
                  const itemActive = isActiveLink(pathname, item.path);
                  const isExternal = isExternalLink(item.path);

                  return (
                    <SubItemLink
                      key={item.title}
                      href={item.path}
                      active={itemActive}
                      target={isExternal ? '_blank' : undefined}
                      rel={isExternal ? 'noopener noreferrer' : undefined}
                      className={cn(megaMenuClasses.subItem, itemActive && megaMenuClasses.active)}
                      sx={slotProps?.subItem}
                    >
                      {item.title}
                    </SubItemLink>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </CollapseContent>
      </Collapse>
    </NavLi>
  );
}

// =============================================================================
// MEGA MENU MOBILE
// =============================================================================

/**
 * MegaMenuMobile - Accordion-style navigation for mobile layouts.
 *
 * @example
 * ```tsx
 * const menuData = [
 *   {
 *     title: 'Products',
 *     path: '/products',
 *     icon: <ProductsIcon />,
 *     children: [
 *       {
 *         subheader: 'Categories',
 *         items: [
 *           { title: 'Electronics', path: '/products/electronics' },
 *           { title: 'Clothing', path: '/products/clothing' },
 *         ],
 *       },
 *     ],
 *   },
 * ];
 *
 * <MegaMenuMobile data={menuData} />
 * ```
 */
export function MegaMenuMobile({
  sx,
  data,
  render,
  slotProps,
  className,
  enabledRootRedirect,
  cssVars: overridesVars,
  ...other
}: MegaMenuProps): React.ReactNode {
  const theme = useTheme();

  const cssVars = { ...megaMenuCssVars(theme, 'mobile'), ...overridesVars };

  return (
    <Nav
      className={cn(megaMenuClasses.root, megaMenuClasses.mobile, className)}
      sx={[{ ...cssVars }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <NavUl className={megaMenuClasses.ul}>
        {data.map((item) => (
          <MegaMenuList
            key={item.title}
            data={item}
            render={render}
            slotProps={slotProps}
            enabledRootRedirect={enabledRootRedirect}
          />
        ))}
      </NavUl>
    </Nav>
  );
}
