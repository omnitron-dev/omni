'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { useScrollSpy } from '../scroll-spy/index.js';

export interface DocHeading {
  id: string;
  text: string;
  level: number;
}

interface DocSectionNavProps {
  headings: DocHeading[];
  title?: string;
}

/**
 * Right-side table of contents connected to ScrollSpy.
 * Native document anchors with a current-section indicator.
 */
export function DocSectionNav({ headings, title = 'On this page' }: DocSectionNavProps) {
  const { activeId } = useScrollSpy();

  if (headings.length === 0) return null;

  return (
    <Box>
      <Typography
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
      </Typography>

      <Box
        component="nav"
        aria-label={title}
        sx={{
          position: 'relative',
          borderLeft: 1,
          borderColor: 'divider',
        }}
      >
        {headings.map((heading) => {
          const isActive = activeId === heading.id;
          const indent = (heading.level - 2) * 1.5;
          return (
            <Box
              key={heading.id}
              component="a"
              href={`#${encodeURIComponent(heading.id)}`}
              aria-current={isActive ? 'location' : undefined}
              sx={{
                display: 'block',
                py: 0.75,
                pl: indent + 2,
                pr: 1,
                ml: '-1px',
                fontSize: '0.8125rem',
                lineHeight: 1.5,
                textDecoration: 'none',
                color: isActive ? 'primary.main' : 'text.disabled',
                fontWeight: isActive ? 600 : 400,
                borderLeft: 2,
                borderColor: isActive ? 'primary.main' : 'transparent',
                transition: 'color 0.2s ease, border-color 0.2s ease',
                cursor: 'pointer',
                '&:hover': {
                  color: isActive ? 'primary.main' : 'text.primary',
                  backgroundColor: (theme) => alpha(theme.palette.action.hover, 0.04),
                  borderRadius: '0 6px 6px 0',
                },
              }}
            >
              {heading.text}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
