import { Fragment } from 'react';
import { Box, Typography } from '@mui/material';

const MONO = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace";

/** Readable recorded fields shared by log and audit disclosures. */
export function EventFields({ values }: { values: Array<[string, unknown]> }) {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: '120px minmax(0, 1fr)' },
        columnGap: 2,
        rowGap: 0.5,
      }}
    >
      {values.map(([key, value]) => (
        <Fragment key={key}>
          <Typography
            component="dt"
            sx={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'text.secondary',
              overflowWrap: 'anywhere',
              pt: { xs: 0.5, sm: 0 },
            }}
          >
            {key}
          </Typography>
          <Box
            component="dd"
            sx={{
              m: 0,
              minWidth: 0,
              fontFamily: MONO,
              fontSize: 11.5,
              lineHeight: 1.65,
              color: 'text.primary',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </Box>
        </Fragment>
      ))}
    </Box>
  );
}
