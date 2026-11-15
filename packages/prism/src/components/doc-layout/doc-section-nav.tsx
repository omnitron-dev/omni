'use client';

import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { semanticTextColor } from '../../theme/semantic-surface.js';
import { useScrollSpy } from '../scroll-spy/index.js';

export interface DocHeading {
  id: string;
  text: string;
  level: number;
}

export interface DocSectionNavProps {
  headings: DocHeading[];
  /** Omit the visible title when the surrounding layout already supplies one. */
  title?: string | null;
  ariaLabel?: string;
  /** Leave undefined to follow ScrollSpy; null explicitly clears the selection. */
  activeId?: string | null;
  className?: string;
}

/**
 * Right-side table of contents connected to ScrollSpy.
 * Native document anchors with a current-section indicator.
 */
export function DocSectionNav({ headings, title = 'On this page', ariaLabel, activeId, className }: DocSectionNavProps) {
  const { activeId: observedId } = useScrollSpy();
  const current = activeId === undefined ? observedId : activeId;

  if (headings.length === 0) return null;

  return (
    <Box component="nav" className={className} aria-label={ariaLabel ?? title ?? 'Table of contents'}>
      {title && <Typography
        variant="overline"
        sx={{
          display: 'block',
          mb: 2,
          color: 'text.secondary',
          fontSize: '0.6875rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
        }}
      >
        {title}
      </Typography>}

      <Box
        component="ul"
        sx={{
          m: 0,
          p: 0,
          listStyle: 'none',
          position: 'relative',
          borderInlineStart: '1px solid',
          borderColor: 'divider',
        }}
      >
        {headings.map((heading) => {
          const isActive = current === heading.id;
          const indent = Math.max(0, Math.min(4, heading.level - 2));
          return (
            <Box key={heading.id} component="li" sx={{ m: 0, p: 0 }}>
              <Link
                href={`#${encodeURIComponent(heading.id)}`}
                aria-current={isActive ? 'location' : undefined}
                underline="none"
                sx={(theme) => ({
                  display: 'block',
                  minHeight: 32,
                  boxSizing: 'border-box',
                  py: 0.75,
                  paddingInlineStart: indent + 2,
                  paddingInlineEnd: 1,
                  marginInlineStart: '-1px',
                  fontSize: '0.8125rem',
                  lineHeight: 1.5,
                  overflowWrap: 'anywhere',
                  color: isActive ? semanticTextColor(theme, 'primary', 'light', 0) : 'text.secondary',
                  ...(isActive && theme.applyStyles('dark', {
                    color: semanticTextColor(theme, 'primary', 'dark', 0),
                  })),
                  fontWeight: isActive ? 600 : 400,
                  borderInlineStart: '2px solid',
                  borderColor: isActive ? 'primary.main' : 'transparent',
                  transition: 'color 120ms ease, border-color 120ms ease, background-color 120ms ease',
                  '&:hover': {
                    ...(!isActive && { color: 'text.primary' }),
                    bgcolor: 'action.hover',
                  },
                  '&:focus-visible': {
                    outline: '2px solid currentColor',
                    outlineOffset: 2,
                  },
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                  '@media (forced-colors: active)': {
                    borderColor: isActive ? 'Highlight' : 'transparent',
                    '&:focus-visible': { outlineColor: 'Highlight' },
                  },
                })}
              >
                {heading.text}
              </Link>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
