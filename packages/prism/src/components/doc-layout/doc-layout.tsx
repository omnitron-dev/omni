'use client';

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

interface DocLayoutProps {
  sidebar?: ReactNode;
  sectionNav?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * 3-column responsive documentation layout.
 * - Left: sidebar (collapsible tree nav)
 * - Center: content (fills available width)
 * - Right: section nav (ToC from headings)
 */
export function DocLayout({ sidebar, sectionNav, children, sx }: DocLayoutProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        ...(sx as any),
      }}
    >
      {sidebar && (
        <Box
          component="nav"
          sx={{
            width: 272,
            flexShrink: 0,
            display: { xs: 'none', md: 'block' },
            position: 'sticky',
            top: 80,
            alignSelf: 'flex-start',
            maxHeight: 'calc(100vh - 100px)',
            overflowY: 'auto',
            pr: 3,
            borderRight: 1,
            borderColor: 'divider',
          }}
        >
          {sidebar}
        </Box>
      )}

      <Box
        component="main"
        sx={{
          flex: 1,
          minWidth: 0,
          px: { xs: 2, md: 4 },
        }}
      >
        {children}
      </Box>

      {sectionNav && (
        <Box
          component="aside"
          sx={{
            width: 240,
            flexShrink: 0,
            display: { xs: 'none', lg: 'block' },
            position: 'sticky',
            top: 80,
            alignSelf: 'flex-start',
            maxHeight: 'calc(100vh - 100px)',
            overflowY: 'auto',
            pl: 3,
          }}
        >
          {sectionNav}
        </Box>
      )}
    </Box>
  );
}
