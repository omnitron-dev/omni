/**
 * Header Section
 *
 * Slot-based header component with sticky positioning and scroll effects.
 *
 * @module @omnitron/prism/layouts/core/header-section
 */

import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { styled, alpha } from '@mui/material/styles';
import type { CSSObject } from '@mui/material/styles';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import type { SxProps, Theme, Breakpoint } from '@mui/material';
import { LAYOUT_CSS_VARS, HEADER_HEIGHTS, type HeaderSlots } from '../types.js';

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to detect scroll offset for header effects.
 */
function useScrollOffset(threshold = 10): boolean {
  const [isOffset, setIsOffset] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          setIsOffset(window.scrollY > threshold);
          ticking = false;
        });
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial position

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [threshold]);

  return isOffset;
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

interface StyledAppBarProps {
  isOffset?: boolean;
  disableOffset?: boolean;
  disableElevation?: boolean;
}

const StyledAppBar = styled(AppBar, {
  shouldForwardProp: (prop) => !['isOffset', 'disableOffset', 'disableElevation'].includes(prop as string),
})<StyledAppBarProps>(({ theme, isOffset, disableOffset, disableElevation }) => {
  // Shared base for pseudo-elements: hidden by default, fade in on scroll
  const pseudoBase: CSSObject = {
    opacity: 0,
    content: '""',
    visibility: 'hidden',
    position: 'absolute',
    transition: theme.transitions.create(['opacity', 'visibility'], {
      easing: theme.transitions.easing.easeInOut,
      duration: theme.transitions.duration.shorter,
    }),
  };

  // ::before — blurred background layer
  const bgStyles: CSSObject = {
    ...pseudoBase,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: -1,
    backdropFilter: `blur(var(${LAYOUT_CSS_VARS.headerBlur}, 8px))`,
    WebkitBackdropFilter: `blur(var(${LAYOUT_CSS_VARS.headerBlur}, 8px))`,
    backgroundColor: alpha(theme.palette.background.default, 0.8),
    ...(isOffset && { opacity: 1, visibility: 'visible' }),
  };

  // ::after — soft diffused shadow
  const shadowStyles: CSSObject = {
    ...pseudoBase,
    left: 0,
    right: 0,
    bottom: 0,
    height: 24,
    margin: 'auto',
    borderRadius: '50%',
    width: 'calc(100% - 48px)',
    zIndex: -2,
    boxShadow: theme.shadows[8],
    ...(isOffset && { opacity: 0.48, visibility: 'visible' }),
  };

  return {
    backgroundColor: 'transparent',
    boxShadow: 'none',
    zIndex: `var(${LAYOUT_CSS_VARS.headerZIndex}, ${theme.zIndex.appBar})`,
    ...(!disableOffset && { '&::before': bgStyles }),
    ...(!disableElevation && { '&::after': shadowStyles }),
  };
});

const StyledToolbar = styled(Toolbar)(({ theme }) => ({
  minHeight: HEADER_HEIGHTS.mobile,
  [theme.breakpoints.up('md')]: {
    minHeight: HEADER_HEIGHTS.desktop,
    paddingLeft: theme.spacing(4),
    paddingRight: theme.spacing(4),
  },
}));

const SlotContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
});

// =============================================================================
// COMPONENT
// =============================================================================

export interface HeaderSectionProps {
  /** Slot content */
  slots?: HeaderSlots;
  /** Props for each slot */
  slotProps?: {
    topArea?: SxProps<Theme>;
    leftArea?: SxProps<Theme>;
    centerArea?: SxProps<Theme>;
    rightArea?: SxProps<Theme>;
    bottomArea?: SxProps<Theme>;
    container?: SxProps<Theme>;
  };
  /** Disable sticky positioning */
  disableSticky?: boolean;
  /** Disable scroll offset effects (blur on scroll) */
  disableOffset?: boolean;
  /** Disable scroll elevation shadow */
  disableElevation?: boolean;
  /** Use container for max-width */
  containerized?: boolean;
  /** Container max width */
  maxWidth?: Breakpoint | false;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Header Section - Slot-based header with scroll effects.
 *
 * Slots:
 * - `topArea`: Content above the main toolbar row
 * - `leftArea`: Left side (logo, menu toggle)
 * - `centerArea`: Center content (search, navigation)
 * - `rightArea`: Right side (actions, user menu)
 * - `bottomArea`: Content below main toolbar (horizontal nav)
 *
 * @example
 * ```tsx
 * <HeaderSection
 *   slots={{
 *     leftArea: (
 *       <>
 *         <MenuButton onClick={onMenuClick} />
 *         <Logo />
 *       </>
 *     ),
 *     centerArea: <Searchbar />,
 *     rightArea: (
 *       <>
 *         <NotificationsButton />
 *         <UserMenu />
 *       </>
 *     ),
 *   }}
 * />
 * ```
 */
export function HeaderSection({
  slots,
  slotProps,
  disableSticky = false,
  disableOffset = false,
  disableElevation = false,
  containerized = false,
  maxWidth = 'lg',
  sx,
}: HeaderSectionProps): ReactNode {
  const isOffset = useScrollOffset();

  const toolbarContent = (
    <>
      {/* Left area */}
      {slots?.leftArea && (
        <SlotContainer sx={{ gap: 1, ...(slotProps?.leftArea as object) }}>{slots.leftArea}</SlotContainer>
      )}

      {/* Center area - flex to push right area to the end */}
      <SlotContainer
        sx={{
          flex: 1,
          justifyContent: 'center',
          mx: 2,
          ...(slotProps?.centerArea as object),
        }}
      >
        {slots?.centerArea}
      </SlotContainer>

      {/* Right area */}
      {slots?.rightArea && (
        <SlotContainer sx={{ gap: 1, ...(slotProps?.rightArea as object) }}>{slots.rightArea}</SlotContainer>
      )}
    </>
  );

  return (
    <StyledAppBar
      position={disableSticky ? 'static' : 'sticky'}
      isOffset={isOffset}
      disableOffset={disableOffset}
      disableElevation={disableElevation}
      sx={sx}
    >
      {/* Top area (above toolbar) */}
      {slots?.topArea && <Box sx={slotProps?.topArea}>{slots.topArea}</Box>}

      {/* Main toolbar */}
      <StyledToolbar>
        {containerized ? (
          <Container
            maxWidth={maxWidth}
            sx={{
              display: 'flex',
              alignItems: 'center',
              ...(slotProps?.container as object),
            }}
          >
            {toolbarContent}
          </Container>
        ) : (
          toolbarContent
        )}
      </StyledToolbar>

      {/* Bottom area (below toolbar, e.g., horizontal nav) */}
      {slots?.bottomArea && <Box sx={slotProps?.bottomArea}>{slots.bottomArea}</Box>}
    </StyledAppBar>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

export interface HeaderToolbarProps {
  /** Content */
  children?: ReactNode;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Standalone header toolbar without AppBar wrapper.
 * Useful for custom header implementations.
 */
export function HeaderToolbar({ children, sx }: HeaderToolbarProps): ReactNode {
  return <StyledToolbar sx={sx}>{children}</StyledToolbar>;
}
