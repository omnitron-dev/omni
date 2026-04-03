'use client';

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

interface ChangelogTimelineProps {
  children: ReactNode;
  sx?: SxProps<Theme>;
}

export function ChangelogTimeline({ children, sx }: ChangelogTimelineProps) {
  return (
    <Box
      sx={{
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: { xs: 16, sm: 24 },
          top: 0,
          bottom: 0,
          width: 2,
          bgcolor: 'divider',
        },
        ...(sx as any),
      }}
    >
      {children}
    </Box>
  );
}
