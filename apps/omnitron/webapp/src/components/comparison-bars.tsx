import { Box, Stack, Typography } from '@mui/material';

interface ComparisonBarsProps {
  label: string;
  items: { id: string; name: string; value: number }[];
  format: (value: number) => string;
}

/** Every category shares the same zero baseline and has a directly readable value. */
export function ComparisonBars({ label, items, format }: ComparisonBarsProps) {
  const largest = items.reduce((max, item) => Math.max(max, item.value), 0);
  return (
    <Stack component="ul" aria-label={label} spacing={1.25} sx={{ m: 0, p: 0, listStyle: 'none', minWidth: 0 }}>
      {items.map(item => (
        <Box component="li" key={item.id} sx={{
          display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 0.5, alignItems: 'baseline',
        }}>
          <Typography component="span" variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.name}</Typography>
          <Typography component="span" variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {format(item.value)}
          </Typography>
          <Box aria-hidden sx={{ gridColumn: '1 / -1', overflow: 'hidden', height: 3, bgcolor: 'action.hover' }}>
            <Box sx={{ height: '100%', bgcolor: 'primary.main' }} style={{ width: `${largest > 0 ? item.value / largest * 100 : 0}%` }} />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}
