'use client';

/**
 * Horizontal Mega Menu
 *
 * Rich dropdown navigation for header layouts.
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
import { styled, useTheme, alpha } from '@mui/material/styles';

import type { MegaMenuProps, MegaMenuListProps } from './types.js';
import { megaMenuClasses, megaMenuCssVars } from './styles.js';
import { cn } from '../../utils/cn.js';
import { isActiveLink, isExternalLink } from '../../utils/url.js';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const Nav = styled('nav')({
  display: 'flex',
  flexShrink: 0,
});

const NavUl = styled('ul')({
  display: 'flex',
  listStyle: 'none',
  padding: 0,
  margin: 0,
});

const NavLi = styled('li')({
  display: 'flex',
});

const NavButton = styled('button')<{ active?: boolean; open?: boolean }>(({ theme, active, open }) => ({
  all: 'unset',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
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
  marginRight: 8,
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
  marginLeft: 6,
  width: 16,
  height: 16,
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
    borderWidth: '0 0 1.5px 1.5px',
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
  display: 'flex',
  gap: 24,
}));

const SectionColumn = styled('div')({
  flex: 1,
  minWidth: 0,
});

const SectionHeader = styled(Typography)(({ theme }) => ({
  fontSize: 'var(--nav-subheader-font-size)',
  fontWeight: 'var(--nav-subheader-font-weight)',
  color: theme.palette.text.disabled,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 12,
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

const TagsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 16,
}));

const Tag = styled(Link)(({ theme }) => ({
  display: 'inline-flex',
  padding: '4px 10px',
  fontSize: '0.75rem',
  fontWeight: 500,
  color: theme.palette.text.secondary,
  backgroundColor: alpha(theme.palette.grey[500], 0.08),
  borderRadius: 6,
  textDecoration: 'none',
  transition: theme.transitions.create(['background-color', 'color'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&:hover': {
    backgroundColor: alpha(theme.palette.grey[500], 0.16),
    color: theme.palette.text.primary,
  },
}));

const MoreLink = styled(Link)(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 0',
  fontSize: '0.875rem',
  fontWeight: 600,
  color: theme.palette.primary.main,
  textDecoration: 'none',
  '&:hover': {
    textDecoration: 'underline',
  },
  '&::after': {
    content: '"→"',
    marginLeft: 4,
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

  const hasChild = Boolean(data.children?.length || data.tags?.length || data.slides?.length);

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
            {/* Child sections */}
            {data.children?.map((section, idx) => (
              <SectionColumn key={section.subheader ?? idx}>
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

                {/* More link at bottom of section */}
                {idx === 0 && data.moreLink && (
                  <Box sx={{ mt: 2 }}>
                    <MoreLink href={data.moreLink.path} className={megaMenuClasses.moreLink} sx={slotProps?.moreLink}>
                      {data.moreLink.title}
                    </MoreLink>
                  </Box>
                )}
              </SectionColumn>
            ))}
          </DropdownContent>

          {/* Tags */}
          {data.tags && data.tags.length > 0 && (
            <Box sx={{ px: 'var(--nav-dropdown-padding)', pb: 'var(--nav-dropdown-padding)' }}>
              <TagsContainer className={megaMenuClasses.tags} sx={slotProps?.tags}>
                {data.tags.map((tag) => (
                  <Tag key={tag.title} href={tag.path}>
                    {tag.title}
                  </Tag>
                ))}
              </TagsContainer>
            </Box>
          )}

          {slots?.bottomArea}
        </Popover>
      )}
    </NavLi>
  );
}

// =============================================================================
// MEGA MENU HORIZONTAL
// =============================================================================

/**
 * MegaMenuHorizontal - Rich dropdown navigation for header layouts.
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
 *       {
 *         subheader: 'Featured',
 *         items: [
 *           { title: 'New Arrivals', path: '/products/new' },
 *           { title: 'Best Sellers', path: '/products/best' },
 *         ],
 *       },
 *     ],
 *     tags: [
 *       { title: 'Sale', path: '/products?filter=sale' },
 *       { title: 'Trending', path: '/products?filter=trending' },
 *     ],
 *     moreLink: { title: 'View All Products', path: '/products' },
 *   },
 *   { title: 'About', path: '/about' },
 * ];
 *
 * <MegaMenuHorizontal data={menuData} />
 * ```
 */
export function MegaMenuHorizontal({
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

  const cssVars = { ...megaMenuCssVars(theme, 'horizontal'), ...overridesVars };

  return (
    <Nav
      className={cn(megaMenuClasses.root, megaMenuClasses.horizontal, className)}
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
