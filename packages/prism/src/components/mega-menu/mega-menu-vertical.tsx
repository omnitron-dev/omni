'use client';

/**
 * Vertical Mega Menu
 *
 * Rich dropdown navigation for sidebar layouts.
 *
 * @module @omnitron-dev/prism/components/mega-menu
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import Box from '@mui/material/Box';
import { useNavPathname } from '../nav-section/nav-context.js';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled, useTheme } from '@mui/material/styles';

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
});

const NavUl = styled('ul')({
  display: 'flex',
  flexDirection: 'column',
  listStyle: 'none',
  padding: 0,
  margin: 0,
});

const NavLi = styled('li')({
  display: 'flex',
  flexDirection: 'column',
});

const NavButton = styled('button')<{ active?: boolean; open?: boolean }>(({ theme, active, open }) => ({
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: 'var(--nav-item-padding)',
  minHeight: 'var(--nav-item-min-height)',
  borderRadius: 'var(--nav-item-radius)',
  fontSize: 'var(--nav-item-font-size)',
  fontWeight: 500,
  color: 'var(--nav-item-color)',
  backgroundColor: 'var(--nav-item-bg)',
  transition: theme.transitions.create(['background-color', 'color'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&:hover': {
    backgroundColor: 'var(--nav-item-hover-bg)',
    color: 'var(--nav-item-hover-color)',
  },
  ...(active && {
    backgroundColor: 'var(--nav-item-active-bg)',
    color: 'var(--nav-item-active-color)',
  }),
  ...(open && {
    backgroundColor: 'var(--nav-item-hover-bg)',
  }),
  '&:disabled': {
    color: 'var(--nav-item-disabled-color)',
    cursor: 'not-allowed',
  },
}));

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
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'transform 0.2s',
  '&::before': {
    content: '""',
    width: 5,
    height: 5,
    borderStyle: 'solid',
    borderWidth: '0 1.5px 1.5px 0',
    borderColor: 'currentColor',
    transform: 'rotate(-45deg)',
  },
}));

const DropdownContent = styled(Paper)(({ theme }) => ({
  width: 'var(--nav-dropdown-width)',
  maxHeight: 'var(--nav-dropdown-max-height)',
  borderRadius: 'var(--nav-dropdown-radius)',
  padding: 'var(--nav-dropdown-padding)',
  overflow: 'auto',
}));

const SectionHeader = styled(Typography)(({ theme }) => ({
  fontSize: 'var(--nav-subheader-font-size)',
  fontWeight: 'var(--nav-subheader-font-weight)',
  color: theme.palette.text.disabled,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 8,
  marginTop: 16,
  '&:first-of-type': {
    marginTop: 0,
  },
}));

const SubItemLink = styled(Link, {
  shouldForwardProp: (prop) => prop !== 'active',
})<{ active?: boolean }>(({ theme, active }) => ({
  display: 'block',
  padding: '6px 0',
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

function MegaMenuList({ data, render, slotProps, slots, enabledRootRedirect }: MegaMenuListProps): React.ReactNode {
  const pathname = useNavPathname();
  const anchorRef = useRef<HTMLButtonElement>(null);

  const isActive = useMemo(
    () => isActiveLink(pathname, data.path, data.deepMatch),
    [pathname, data.path, data.deepMatch]
  );

  const hasChild = Boolean(data.children?.length);

  const childActive = useMemo(() => {
    if (!data.children?.length) return false;
    return data.children.some((section) => section.items.some((item) => isActiveLink(pathname, item.path)));
  }, [data.children, pathname]);

  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    if (hasChild) {
      setOpen(true);
    }
  }, [hasChild]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    handleClose();
  }, [pathname, handleClose]);

  // Resolve icon
  const icon = typeof data.icon === 'string' && render?.navIcon ? render.navIcon[data.icon] : data.icon;

  return (
    <NavLi className={megaMenuClasses.li}>
      <NavButton
        ref={anchorRef}
        className={cn(
          megaMenuClasses.item,
          (isActive || childActive) && megaMenuClasses.active,
          open && megaMenuClasses.open
        )}
        active={isActive || childActive}
        open={open}
        disabled={data.disabled}
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
      >
        {icon && <IconWrapper className={megaMenuClasses.icon}>{icon}</IconWrapper>}
        <span className={megaMenuClasses.title}>{data.title}</span>
        {hasChild && <ArrowIcon open={open} className={megaMenuClasses.arrow} />}
      </NavButton>

      {hasChild && (
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
                ...slotProps?.dropdown,
              },
            },
          }}
          sx={{
            pointerEvents: 'none',
          }}
          disableRestoreFocus
        >
          {slots?.topArea}

          <DropdownContent elevation={0} className={megaMenuClasses.dropdown}>
            {data.children?.map((section, idx) => (
              <Box key={section.subheader ?? idx}>
                {section.subheader && (
                  <SectionHeader className={megaMenuClasses.subheader}>{section.subheader}</SectionHeader>
                )}
                <Stack spacing={0.5}>
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
          </DropdownContent>

          {slots?.bottomArea}
        </Popover>
      )}
    </NavLi>
  );
}

// =============================================================================
// MEGA MENU VERTICAL
// =============================================================================

/**
 * MegaMenuVertical - Rich dropdown navigation for sidebar layouts.
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
 * <MegaMenuVertical data={menuData} />
 * ```
 */
export function MegaMenuVertical({
  sx,
  data,
  render,
  slotProps,
  slots,
  className,
  enabledRootRedirect,
  cssVars: overridesVars,
  ...other
}: MegaMenuProps): React.ReactNode {
  const theme = useTheme();

  const cssVars = { ...megaMenuCssVars(theme, 'vertical'), ...overridesVars };

  return (
    <Nav
      className={cn(megaMenuClasses.root, megaMenuClasses.vertical, className)}
      sx={[{ ...cssVars }, ...(Array.isArray(sx) ? sx : [sx])]}
      {...other}
    >
      <NavUl className={megaMenuClasses.ul} sx={{ gap: 'var(--nav-item-gap)' }}>
        {data.map((item) => (
          <MegaMenuList
            key={item.title}
            data={item}
            render={render}
            slotProps={slotProps}
            slots={slots}
            enabledRootRedirect={enabledRootRedirect}
          />
        ))}
      </NavUl>
    </Nav>
  );
}
