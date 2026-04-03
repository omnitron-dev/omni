'use client';

/**
 * Navigation Base Components
 *
 * Foundational components for building navigation sections.
 *
 * @module @omnitron/prism/components/nav-section
 */

import { forwardRef } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import { styled, alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { cn } from '../../utils/cn.js';
import { navSectionClasses } from './styles.js';

// =============================================================================
// NAV (ROOT ELEMENT)
// =============================================================================

/**
 * Props for Nav component.
 */
export interface NavProps extends Omit<React.ComponentPropsWithoutRef<'nav'>, 'sx'> {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * Nav - Root navigation element for navigation sections.
 */
export const Nav = forwardRef<HTMLElement, NavProps>(function Nav({ className, sx, ...other }, ref) {
  return (
    <Box
      component="nav"
      ref={ref}
      className={cn(navSectionClasses.root, className)}
      sx={[
        {
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
});

// =============================================================================
// NAV UL (UNORDERED LIST)
// =============================================================================

/**
 * Props for NavUl component.
 */
export interface NavUlProps extends Omit<React.ComponentPropsWithoutRef<'ul'>, 'sx'> {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * NavUl - Styled unordered list for navigation.
 */
export const NavUl = forwardRef<HTMLUListElement, NavUlProps>(function NavUl({ className, sx, ...other }, ref) {
  return (
    <Box
      component="ul"
      ref={ref}
      className={cn(navSectionClasses.ul, className)}
      sx={[
        {
          display: 'flex',
          flexDirection: 'column',
          listStyle: 'none',
          padding: 0,
          margin: 0,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
});

// =============================================================================
// NAV LI (LIST ITEM)
// =============================================================================

/**
 * Props for NavLi component.
 */
export interface NavLiProps extends React.ComponentPropsWithoutRef<'li'> {
  children: React.ReactNode;
}

/**
 * NavLi - Styled list item for navigation.
 */
export const NavLi = forwardRef<HTMLLIElement, NavLiProps>(function NavLi({ className, ...other }, ref) {
  return (
    <Box
      component="li"
      ref={ref}
      className={cn(navSectionClasses.li, className)}
      sx={{
        display: 'flex',
        flexDirection: 'column',
      }}
      {...other}
    />
  );
});

// =============================================================================
// NAV SUBHEADER
// =============================================================================

/**
 * Props for NavSubheader component.
 */
export interface NavSubheaderProps extends React.ComponentPropsWithoutRef<typeof ButtonBase> {
  /** Whether the section is open */
  open?: boolean;
  /** Click handler for toggle */
  onClick?: () => void;
  children: React.ReactNode;
}

const StyledSubheader = styled(ButtonBase)(({ theme }) => ({
  width: '100%',
  cursor: 'pointer',
  padding: 'var(--nav-subheader-padding, 8px 8px 8px 12px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  fontSize: 'var(--nav-subheader-font-size, 0.6875rem)',
  fontWeight: 'var(--nav-subheader-font-weight, 700)',
  color: 'var(--nav-subheader-color, inherit)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderRadius: theme.shape.borderRadius,
  transition: theme.transitions.create(['background-color', 'color'], {
    duration: theme.transitions.duration.shorter,
  }),
  '&:hover': {
    backgroundColor: alpha(theme.palette.grey[500], 0.08),
  },
}));

const ArrowIcon = styled('span')<{ open?: boolean }>(({ open }) => ({
  marginLeft: 'auto',
  width: 16,
  height: 16,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'transform 0.2s',
  transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
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

/**
 * NavSubheader - Section header with collapse toggle.
 */
export const NavSubheader = forwardRef<HTMLButtonElement, NavSubheaderProps>(function NavSubheader(
  { className, open, onClick, children, ...other },
  ref
) {
  return (
    <StyledSubheader ref={ref} className={cn(navSectionClasses.subheader, className)} onClick={onClick} {...other}>
      {children}
      {onClick && <ArrowIcon open={open} />}
    </StyledSubheader>
  );
});

// =============================================================================
// NAV ITEM (BASE)
// =============================================================================

/**
 * Props for NavItemBase component.
 */
export interface NavItemBaseProps extends React.ComponentPropsWithoutRef<typeof ButtonBase> {
  /** Whether the item is active */
  active?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Whether the submenu is open */
  open?: boolean;
  /** Item depth level */
  depth?: number;
  /** Whether item has children */
  hasChild?: boolean;
  children: React.ReactNode;
}

const StyledNavItem = styled(ButtonBase, {
  shouldForwardProp: (prop) => !['active', 'open', 'depth', 'hasChild'].includes(prop as string),
})<{ active?: boolean; open?: boolean; depth?: number; hasChild?: boolean }>(
  ({ theme, active, open, depth = 1, hasChild }) => ({
    width: '100%',
    minHeight: 'var(--nav-item-min-height, 44px)',
    padding: depth === 1 ? 'var(--nav-item-padding)' : 'var(--nav-sub-item-padding)',
    marginLeft: depth > 1 ? `calc(var(--nav-sub-item-margin-left, 40px) * ${depth - 1})` : 0,
    borderRadius: `var(--nav-item-radius, ${theme.shape.borderRadius}px)`,
    color: 'var(--nav-item-color)',
    backgroundColor: 'var(--nav-item-bg, transparent)',
    transition: theme.transitions.create(['background-color', 'color'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&:hover': {
      backgroundColor: 'var(--nav-item-hover-bg)',
      color: 'var(--nav-item-hover-color)',
    },
    // Active state
    ...(active && {
      backgroundColor: 'var(--nav-item-active-bg)',
      color: 'var(--nav-item-active-color)',
      '& .nav-icon': {
        color: 'var(--nav-icon-active-color)',
      },
    }),
    // Open state (submenu open)
    ...(open && {
      backgroundColor: 'var(--nav-item-hover-bg)',
      color: 'var(--nav-item-hover-color)',
    }),
    // Disabled state
    '&.Mui-disabled': {
      color: 'var(--nav-item-disabled-color)',
      pointerEvents: 'none',
    },
  })
);

/**
 * NavItemBase - Base button component for nav items.
 */
export const NavItemBase = forwardRef<HTMLButtonElement, NavItemBaseProps>(function NavItemBase(
  { className, active, disabled, open, depth, hasChild, ...other },
  ref
) {
  return (
    <StyledNavItem
      ref={ref}
      className={cn(
        navSectionClasses.item,
        active && navSectionClasses.active,
        disabled && navSectionClasses.disabled,
        open && navSectionClasses.open,
        className
      )}
      active={active}
      open={open}
      depth={depth}
      hasChild={hasChild}
      disabled={disabled}
      {...other}
    />
  );
});

// =============================================================================
// NAV ICON
// =============================================================================

/**
 * Props for NavIcon component.
 */
export interface NavIconProps {
  /** Icon element */
  icon?: React.ReactNode;
  /** Custom className */
  className?: string;
}

const IconWrapper = styled('span')({
  width: 'var(--nav-icon-size, 24px)',
  height: 'var(--nav-icon-size, 24px)',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: 'var(--nav-icon-margin, 0 16px 0 0)',
  color: 'var(--nav-icon-color)',
  '& svg': {
    width: '100%',
    height: '100%',
  },
});

/**
 * NavIcon - Icon wrapper for nav items.
 */
export function NavIcon({ icon, className }: NavIconProps): React.ReactNode {
  if (!icon) return null;
  return <IconWrapper className={cn('nav-icon', navSectionClasses.icon, className)}>{icon}</IconWrapper>;
}

// =============================================================================
// NAV TEXTS
// =============================================================================

/**
 * Props for NavTexts component.
 */
export interface NavTextsProps {
  /** Title text */
  title: string;
  /** Caption text */
  caption?: string;
  /** Custom className */
  className?: string;
}

const TextsWrapper = styled('span')({
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  minWidth: 0,
});

const Title = styled('span')({
  fontSize: 'var(--nav-item-font-size, 0.875rem)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
  lineHeight: 1.5,
});

const Caption = styled('span')(({ theme }) => ({
  fontSize: 'var(--nav-item-caption-size, 0.75rem)',
  color: theme.palette.text.disabled,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: '100%',
  lineHeight: 1.5,
}));

/**
 * NavTexts - Text content for nav items.
 */
export function NavTexts({ title, caption, className }: NavTextsProps): React.ReactNode {
  return (
    <TextsWrapper className={cn(navSectionClasses.texts, className)}>
      <Title className={navSectionClasses.title}>{title}</Title>
      {caption && <Caption className={navSectionClasses.caption}>{caption}</Caption>}
    </TextsWrapper>
  );
}

// =============================================================================
// NAV ARROW
// =============================================================================

/**
 * Props for NavArrow component.
 */
export interface NavArrowProps {
  /** Whether submenu is open */
  open?: boolean;
  /** Arrow direction */
  direction?: 'down' | 'right';
  /** Custom className */
  className?: string;
}

const ArrowWrapper = styled('span')<{ open?: boolean; direction?: 'down' | 'right' }>(
  ({ open, direction = 'right' }) => ({
    width: 16,
    height: 16,
    flexShrink: 0,
    marginLeft: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.2s',
    transform: open ? (direction === 'down' ? 'rotate(180deg)' : 'rotate(90deg)') : 'rotate(0deg)',
    '&::before': {
      content: '""',
      width: 5,
      height: 5,
      borderStyle: 'solid',
      borderWidth: '0 1.5px 1.5px 0',
      borderColor: 'currentColor',
      transform: direction === 'down' ? 'rotate(45deg)' : 'rotate(45deg)',
    },
  })
);

/**
 * NavArrow - Arrow indicator for items with children.
 */
export function NavArrow({ open, direction = 'right', className }: NavArrowProps): React.ReactNode {
  return <ArrowWrapper className={cn(navSectionClasses.arrow, className)} open={open} direction={direction} />;
}

// =============================================================================
// NAV INFO
// =============================================================================

/**
 * Props for NavInfo component.
 */
export interface NavInfoProps {
  /** Info content */
  info?: React.ReactNode;
  /** Custom className */
  className?: string;
}

const InfoWrapper = styled('span')({
  marginLeft: 6,
  display: 'inline-flex',
  alignItems: 'center',
});

/**
 * NavInfo - Info badge/content for nav items.
 */
export function NavInfo({ info, className }: NavInfoProps): React.ReactNode {
  if (!info) return null;
  return <InfoWrapper className={cn(navSectionClasses.info, className)}>{info}</InfoWrapper>;
}
