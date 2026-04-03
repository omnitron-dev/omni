'use client';

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

interface ChangelogEntryProps {
  version: string;
  date: string;
  badge?: string | null;
  children: ReactNode;
}

export function ChangelogEntry({ version, date, badge, children }: ChangelogEntryProps) {
  return (
    <Box sx={{ position: 'relative', pl: { xs: 5, sm: 7 }, pb: 4 }}>
      {/* Timeline dot */}
      <Box
        sx={{
          position: 'absolute',
          left: { xs: 10, sm: 18 },
          top: 8,
          width: 14,
          height: 14,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          border: 3,
          borderColor: 'background.paper',
          zIndex: 1,
        }}
      />

      <Card variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={700}>
            {version}
          </Typography>
          {badge && <Chip label={badge} size="small" color="primary" variant="soft" />}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto !important' }}>
            {date}
          </Typography>
        </Stack>

        {children}
      </Card>
    </Box>
  );
}
