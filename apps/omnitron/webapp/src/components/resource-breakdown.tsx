import { useState } from 'react';
import { Card, CardContent, CardHeader, MenuItem, TextField, Typography } from '@mui/material';
import { ComparisonBars } from './comparison-bars';
import { formatBytes, formatCpu } from 'src/utils/metric-series';
import type { ShownApp } from 'src/utils/app-address';

/** A ranked snapshot, with its scale named. No implied capacity or alarm threshold. */
export function ResourceBreakdown({ apps }: { apps: ShownApp[] }) {
  const [resource, setResource] = useState<'memory' | 'cpu'>('memory');
  const format = resource === 'memory' ? formatBytes : formatCpu;
  const sorted = apps
    .filter((app) => Number.isFinite(app[resource]) && app[resource] >= 0)
    .sort((a, b) => b[resource] - a[resource])
    .slice(0, 6);
  const rows = sorted.map(app => ({
    id: app.key,
    name: apps.some(other => other.name === app.name && other.key !== app.key) ? `${app.name} · ${app.key}` : app.name,
    value: app[resource],
  }));
  return (
    <Card variant="outlined">
      <CardHeader
        title="Resource distribution"
        subheader={sorted.length ? `Top ${sorted.length} · latest readings, scaled to largest` : 'Latest readings'}
        slotProps={{ title: { variant: 'subtitle2' }, subheader: { variant: 'caption' } }}
        action={
          <TextField
            select
            size="small"
            label="Resource"
            value={resource}
            onChange={(e) => setResource(e.target.value as 'memory' | 'cpu')}
            sx={{ minWidth: 130 }}
          >
            <MenuItem value="memory">Memory</MenuItem>
            <MenuItem value="cpu">CPU</MenuItem>
          </TextField>
        }
      />
      <CardContent sx={{ pt: 0, px: { xs: 1.5, sm: 2 } }}>
        {sorted.length ? (
          <ComparisonBars label={resource === 'memory' ? 'Resident memory by application' : 'CPU by application'} items={rows} format={format} />
        ) : (
          <Typography variant="body2" color="text.secondary">
            No resource readings available.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
