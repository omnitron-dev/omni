import { useState } from 'react';
import { MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DashboardBlock } from '@omnitron-dev/prism/blocks';
import { ComparisonBars } from './comparison-bars';
import { formatBytes, formatCpu } from 'src/utils/metric-series';
import type { ShownApp } from 'src/utils/app-address';

export function ResourceBreakdown({ apps }: { apps: ShownApp[] }) {
  return (
    <DashboardBlock
      title="Resource distribution"
      size="small"
      variant="outlined"
      collapsible
      defaultCollapsed
      mountOnEnter
      slotProps={{ header: { headingComponent: 'h2' } }}
      labels={{ expand: 'Show resource distribution', collapse: 'Hide resource distribution' }}
    >
      <ResourceReadings apps={apps} />
    </DashboardBlock>
  );
}

function ResourceReadings({ apps }: { apps: ShownApp[] }) {
  const [resource, setResource] = useState<'memory' | 'cpu'>('memory');
  const names = new Set<string>();
  const duplicates = new Set<string>();
  for (const app of apps) {
    if (names.has(app.name)) duplicates.add(app.name);
    names.add(app.name);
  }
  const rows = apps
    .filter((app) => Number.isFinite(app[resource]) && app[resource] >= 0)
    .sort((a, b) => b[resource] - a[resource] || a.key.localeCompare(b.key))
    .slice(0, 6)
    .map((app) => ({ id: app.key, name: duplicates.has(app.name) ? app.key : app.name, value: app[resource] }));
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          {rows.length ? `Top ${rows.length} · scaled to the largest reading` : 'No readings available.'}
        </Typography>
        <TextField
          select
          size="small"
          label="Resource"
          value={resource}
          onChange={(event) => setResource(event.target.value === 'cpu' ? 'cpu' : 'memory')}
          sx={{ minWidth: 116 }}
        >
          <MenuItem value="memory">Memory</MenuItem>
          <MenuItem value="cpu">CPU</MenuItem>
        </TextField>
      </Stack>
      {!!rows.length && (
        <ComparisonBars
          label={resource === 'memory' ? 'Resident memory by application' : 'CPU by application'}
          items={rows}
          format={resource === 'memory' ? formatBytes : formatCpu}
        />
      )}
    </Stack>
  );
}
