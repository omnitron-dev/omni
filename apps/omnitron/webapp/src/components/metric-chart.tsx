import { useId, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Collapse,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Chart, useChart } from '@omnitron-dev/prism/components/chart';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { TableViewport } from '@omnitron-dev/prism/components/table';
import type { MetricLine } from 'src/utils/metric-series';

interface Props {
  title: string;
  description: string;
  lines: MetricLine[];
  format: (value: number) => string;
  from: number;
  to: number;
  loading?: boolean;
  error?: string | null;
  height?: number;
}

/** A quiet plot, keyboard-operable series selection, and an exact tabular alternative. */
export function MetricChart({ title, description, lines, format, from, to, loading, error, height = 260 }: Props) {
  const theme = useTheme();
  const id = useId();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState(false);
  const palette = [
    theme.palette.primary.main,
    theme.palette.info.main,
    theme.palette.warning.main,
    theme.palette.success.main,
    theme.palette.secondary.main,
    theme.palette.error.main,
  ];
  const colorIndices = new Map(
    [...lines].sort((a, b) => a.id.localeCompare(b.id)).map((line, index) => [line.id, index])
  );
  const color = (line: MetricLine) => palette[(colorIndices.get(line.id) ?? 0) % palette.length]!;
  const visible = lines.filter((line) => !hidden.has(line.id));
  const options = useChart({
    chart: { animations: { enabled: false }, background: 'transparent', redrawOnParentResize: true },
    colors: visible.map(color),
    stroke: { curve: 'straight', width: 2 },
    fill: { opacity: 1 },
    markers: { size: visible.every((line) => line.count <= 1) ? 3 : 0 },
    xaxis: {
      type: 'datetime',
      min: from,
      max: to,
      tickAmount: 4,
      labels: { datetimeUTC: false, hideOverlappingLabels: true, format: 'HH:mm' },
    },
    yaxis: { min: 0, tickAmount: 4, forceNiceScale: true, labels: { formatter: format, minWidth: 48, maxWidth: 72 } },
    tooltip: { x: { format: 'dd MMM HH:mm:ss' }, y: { formatter: format } },
    grid: { padding: { left: 0, right: 12, top: 4, bottom: 0 } },
    legend: { show: false },
  });

  return (
    <Card variant="outlined" sx={{ minWidth: 0, height: '100%' }}>
      <CardHeader
        sx={{ '& .MuiCardHeader-content': { flex: '1 1 0%' } }}
        title={title}
        subheader={description}
        slotProps={{ title: { id: `${id}-title`, variant: 'subtitle2' }, subheader: { variant: 'caption' } }}
        action={
          <Button
            size="small"
            disabled={!lines.length}
            aria-expanded={details}
            aria-controls={`${id}-data`}
            onClick={() => setDetails(!details)}
          >
            Data
          </Button>
        }
      />
      <CardContent sx={{ pt: 0, px: { xs: 1.5, sm: 2 } }}>
        {error && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 1 }}>
            {error}
            {lines.length ? ' Showing the last received samples.' : ''}
          </Alert>
        )}
        {loading ? (
          <Skeleton variant="rectangular" height={height} />
        ) : !lines.length ? (
          <Stack sx={{ minHeight: height, alignItems: 'center', justifyContent: 'center', p: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {error ? 'History unavailable' : 'No samples in this window'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Choose another interval or check the application’s metrics collection.
            </Typography>
          </Stack>
        ) : (
          <>
            {visible.length ? (
              <Chart
                type="line"
                height={height}
                options={options}
                series={visible.map((line) => ({ name: line.name, data: line.data }))}
                role="img"

                aria-label={`${title}: ${visible.length} series. Exact values are available with Data.`}
              />
            ) : (
              <Stack sx={{ height, alignItems: 'center', justifyContent: 'center' }}>
                <Button onClick={() => setHidden(new Set())}>Show all series</Button>
              </Stack>
            )}
            <Stack
              direction="row"
              spacing={0.75}
              useFlexGap
              sx={{ flexWrap: 'wrap', maxHeight: 128, overflowY: 'auto', p: 0.5 }}
              role="group"
              aria-label={`${title} series`}
            >
              {lines.map((line) => (
                <Chip
                  key={line.id}
                  component="button"
                  clickable
                  size="small"
                  variant="outlined"
                  aria-pressed={!hidden.has(line.id)}
                  aria-label={`${line.name}, ${format(line.latest)}. ${hidden.has(line.id) ? 'Show' : 'Hide'} series`}
                  onClick={() =>
                    setHidden((previous) => {
                      const next = new Set(previous);
                      next.has(line.id) ? next.delete(line.id) : next.add(line.id);
                      return next;
                    })
                  }
                  icon={
                    <Box
                      component="span"
                      sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color(line), flexShrink: 0 }}
                    />
                  }
                  label={`${line.name} · ${format(line.latest)}`}
                  sx={{
                    maxWidth: '100%',
                    height: 'auto',
                    minHeight: 28,
                    textAlign: 'left',
                    opacity: hidden.has(line.id) ? 0.5 : 1,
                    '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.5 },
                  }}
                />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Select a series to hide or show it. Values are the latest returned bucket; gaps indicate missing samples.
            </Typography>
          </>
        )}
        <Collapse in={details} id={`${id}-data`}>
          <TableViewport label={`${title} data`} maxHeight={320} sx={{ mt: 1 }}>
            <Table size="small" sx={{ minWidth: 540 }}>
              <TableHead>
                <TableRow>
                  {['Series', 'Latest', 'Mean', 'Peak', 'Samples', 'Last sample'].map((label) => (
                    <TableCell key={label}>{label}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell component="th" scope="row" sx={{ overflowWrap: 'anywhere', maxWidth: 240 }}>
                      {line.name}
                    </TableCell>
                    <TableCell>{format(line.latest)}</TableCell>
                    <TableCell>{format(line.average)}</TableCell>
                    <TableCell>{format(line.peak)}</TableCell>
                    <TableCell>{line.count}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(line.lastAt).toLocaleTimeString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableViewport>
        </Collapse>
      </CardContent>
    </Card>
  );
}
