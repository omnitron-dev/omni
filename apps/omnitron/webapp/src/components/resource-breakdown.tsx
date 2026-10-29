import { useState } from 'react';
import { Card, CardContent, CardHeader, MenuItem, TextField, Typography } from '@mui/material';
import { Chart, useChart } from '@omnitron-dev/prism/components/chart';
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
  const names = sorted.map(
    (app) =>
      `${app.name}${apps.some((other) => other.name === app.name && other.key !== app.key) ? ` · ${app.key}` : ''}`
  );
  const options = useChart({
    chart: { animations: { enabled: false }, redrawOnParentResize: true },
    plotOptions: { bar: { horizontal: true, barHeight: '44%', borderRadius: 2 } },
    xaxis: { categories: names, tickAmount: 3, labels: { formatter: (value: string) => format(Number(value)) } },
    yaxis: { labels: { maxWidth: 120 } },
    tooltip: { y: { formatter: format } },
    grid: { padding: { right: 12 } },
  });
  return (
    <Card variant="outlined">
      <CardHeader
        title="Resource distribution"
        subheader={`Largest ${sorted.length} applications · latest readings`}
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
          <Chart
            type="bar"
            height={Math.max(170, sorted.length * 28 + 60)}
            options={options}
            series={[
              { name: resource === 'memory' ? 'Resident memory' : 'CPU', data: sorted.map((app) => app[resource]) },
            ]}
            role="img"
            aria-label={`Resource distribution: ${sorted.map((app, i) => `${names[i]} ${format(app[resource])}`).join('; ')}`}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            No resource readings available.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
