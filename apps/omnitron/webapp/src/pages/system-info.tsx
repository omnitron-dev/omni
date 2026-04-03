/**
 * System Info Page — Real-time system metrics + build info
 *
 * Cards:
 * - Daemon: role, PID, uptime, process memory
 * - CPU: model, cores, load per core, temperature
 * - Memory: total/used/free with progress bar, swap
 * - Disks: mount points with usage bars
 * - Network: interfaces, throughput
 * - Docker: container counts
 * - Build: version, runtime, arch, dev-stack
 *
 * Auto-refreshes every 5s via polling (uses OmnitronSystemInfo RPC).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Grid from '@mui/material/Grid';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import Box from '@mui/material/Box';
import { alpha, useTheme } from '@mui/material/styles';

import { systemInfo } from 'src/netron/client';
import { formatMemory } from 'src/utils/formatters';

// =============================================================================
// Shared
// =============================================================================

const cardSx = { borderRadius: 2, height: '100%' } as const;
const cardContentSx = { p: 3, '&:last-child': { pb: 3 } } as const;

function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={600} sx={mono ? { fontFamily: 'monospace', fontSize: '0.8rem' } : undefined}>
        {value}
      </Typography>
    </Stack>
  );
}

function UsageBar({ label, used, total, color = 'primary' }: { label: string; used: number; total: number; color?: 'primary' | 'warning' | 'error' | 'success' }) {
  const percent = total > 0 ? (used / total) * 100 : 0;
  const barColor = percent > 90 ? 'error' : percent > 70 ? 'warning' : color;

  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Typography variant="caption" fontWeight={600} sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
          {formatMemory(used)} / {formatMemory(total)} ({percent.toFixed(1)}%)
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={Math.min(percent, 100)} color={barColor} sx={{ height: 6, borderRadius: 3 }} />
    </Box>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h ${m}m` : `${d}d ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// =============================================================================
// Page
// =============================================================================

export default function SystemInfoPage() {
  const theme = useTheme();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const snapshot = await systemInfo.getSnapshot();
      setData(snapshot);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch system info');
    } finally {
      if (isFirstLoad.current) { setLoading(false); isFirstLoad.current = false; }
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 5000);
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading) {
    return (
      <Grid container spacing={3}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Grid key={i} size={{ xs: 12, md: 6 }}><Skeleton variant="rounded" height={200} /></Grid>
        ))}
      </Grid>
    );
  }

  if (error && !data) {
    return <Alert severity="error">{error}</Alert>;
  }

  const d = data;
  const statusColor = d ? theme.palette.success.main : theme.palette.error.main;

  return (
    <Stack spacing={3}>
      {error && <Alert severity="warning" variant="outlined">{error}</Alert>}

      <Grid container spacing={3}>
        {/* Daemon */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={cardSx}>
            <CardHeader
              title="Daemon"
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
              action={<Chip label={d?.daemon?.role ?? 'master'} size="small" color="primary" variant="outlined" sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }} />}
            />
            <CardContent sx={{ ...cardContentSx, pt: 0 }}>
              <Stack spacing={0.5}>
                <InfoRow label="PID" value={d?.daemon?.pid ?? '--'} mono />
                <InfoRow label="Uptime" value={d?.daemon?.uptimeMs ? formatDuration(d.daemon.uptimeMs) : '--'} />
                <InfoRow label="Node.js" value={d?.daemon?.nodeVersion ?? '--'} mono />
                <InfoRow label="V8" value={d?.daemon?.v8Version ?? '--'} mono />
              </Stack>
              {d?.daemon?.memoryUsage && (
                <>
                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1, display: 'block' }}>Process Memory</Typography>
                  <UsageBar label="Heap" used={d.daemon.memoryUsage.heapUsed} total={d.daemon.memoryUsage.heapTotal} />
                  <InfoRow label="RSS" value={formatMemory(d.daemon.memoryUsage.rss)} mono />
                  <InfoRow label="External" value={formatMemory(d.daemon.memoryUsage.external)} mono />
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* CPU */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={cardSx}>
            <CardHeader
              title="CPU"
              titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
              action={
                d?.cpu?.currentLoad != null ? (
                  <Chip
                    label={`${d.cpu.currentLoad.toFixed(1)}%`}
                    size="small"
                    color={d.cpu.currentLoad > 80 ? 'error' : d.cpu.currentLoad > 60 ? 'warning' : 'success'}
                    sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                  />
                ) : undefined
              }
            />
            <CardContent sx={{ ...cardContentSx, pt: 0 }}>
              <Stack spacing={0.5}>
                <InfoRow label="Model" value={`${d?.cpu?.manufacturer ?? ''} ${d?.cpu?.brand ?? ''}`} />
                <InfoRow label="Cores" value={`${d?.cpu?.physicalCores ?? 0} physical / ${d?.cpu?.cores ?? 0} logical`} />
                <InfoRow label="Speed" value={d?.cpu?.speed ? `${d.cpu.speed} GHz` : '--'} />
                {d?.cpu?.temperature != null && <InfoRow label="Temperature" value={`${d.cpu.temperature}°C`} />}
              </Stack>
              {d?.cpu?.loadPerCore?.length > 0 && (
                <>
                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mb: 1, display: 'block' }}>Load per Core</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {d.cpu.loadPerCore.map((load: number, i: number) => (
                      <Box
                        key={i}
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          fontFamily: 'monospace',
                          bgcolor: alpha(load > 80 ? theme.palette.error.main : load > 50 ? theme.palette.warning.main : theme.palette.success.main, 0.12),
                          color: load > 80 ? 'error.main' : load > 50 ? 'warning.main' : 'success.main',
                          border: '1px solid',
                          borderColor: alpha(load > 80 ? theme.palette.error.main : load > 50 ? theme.palette.warning.main : theme.palette.success.main, 0.2),
                        }}
                      >
                        {load.toFixed(0)}%
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Memory */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={cardSx}>
            <CardHeader title="Memory" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} />
            <CardContent sx={{ ...cardContentSx, pt: 0 }}>
              {d?.memory && (
                <>
                  <UsageBar label="RAM" used={d.memory.used} total={d.memory.total} color="primary" />
                  {d.memory.swapTotal > 0 && (
                    <UsageBar label="Swap" used={d.memory.swapUsed} total={d.memory.swapTotal} color="warning" />
                  )}
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    <InfoRow label="Total" value={formatMemory(d.memory.total)} mono />
                    <InfoRow label="Available" value={formatMemory(d.memory.available)} mono />
                    <InfoRow label="Free" value={formatMemory(d.memory.free)} mono />
                  </Stack>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Disks */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={cardSx}>
            <CardHeader title="Disks" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} />
            <CardContent sx={{ ...cardContentSx, pt: 0 }}>
              {d?.disks?.length > 0 ? (
                d.disks.map((disk: any, i: number) => (
                  <Box key={i}>
                    <UsageBar
                      label={`${disk.mount} (${disk.type})`}
                      used={disk.used}
                      total={disk.size}
                      color="primary"
                    />
                  </Box>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">No disk information available</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Network */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={cardSx}>
            <CardHeader title="Network" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} />
            <CardContent sx={{ ...cardContentSx, pt: 0 }}>
              {d?.network?.interfaces?.length > 0 ? (
                <Stack spacing={1}>
                  {d.network.interfaces.slice(0, 5).map((iface: any, i: number) => (
                    <Box key={i}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2" fontWeight={600}>{iface.iface}</Typography>
                        <Chip
                          label={iface.operstate}
                          size="small"
                          color={iface.operstate === 'up' ? 'success' : 'default'}
                          variant="outlined"
                          sx={{ height: 18, fontSize: '0.6rem' }}
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                        {iface.ip4 || iface.ip6 || '--'}
                        {iface.speed ? ` · ${iface.speed} Mbps` : ''}
                      </Typography>
                    </Box>
                  ))}
                  {(d.network.rxSec > 0 || d.network.txSec > 0) && (
                    <>
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" spacing={2}>
                        <InfoRow label="RX" value={`${formatMemory(d.network.rxSec)}/s`} mono />
                        <InfoRow label="TX" value={`${formatMemory(d.network.txSec)}/s`} mono />
                      </Stack>
                    </>
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">No network interfaces</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Docker */}
        {d?.docker && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={cardSx}>
              <CardHeader title="Docker" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} />
              <CardContent sx={{ ...cardContentSx, pt: 0 }}>
                <Stack spacing={0.5}>
                  <InfoRow label="Running" value={d.docker.running} />
                  <InfoRow label="Paused" value={d.docker.paused} />
                  <InfoRow label="Stopped" value={d.docker.stopped} />
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* OS */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={cardSx}>
            <CardHeader title="Operating System" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} />
            <CardContent sx={{ ...cardContentSx, pt: 0 }}>
              <Stack spacing={0.5}>
                <InfoRow label="Platform" value={d?.os?.platform ?? '--'} />
                <InfoRow label="Distribution" value={d?.os?.distro ?? '--'} />
                <InfoRow label="Release" value={d?.os?.release ?? '--'} mono />
                <InfoRow label="Kernel" value={d?.os?.kernel ?? '--'} mono />
                <InfoRow label="Architecture" value={d?.os?.arch ?? '--'} mono />
                <InfoRow label="Hostname" value={d?.os?.hostname ?? '--'} mono />
                <InfoRow label="Uptime" value={d?.os?.uptime ? formatDuration(d.os.uptime * 1000) : '--'} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Build */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={cardSx}>
            <CardHeader title="Build" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} />
            <CardContent sx={{ ...cardContentSx, pt: 0 }}>
              <Stack spacing={0.5}>
                <InfoRow label="Console" value="Vite + React 19" mono />
                <InfoRow label="RPC" value="Netron HTTP" mono />
                <InfoRow label="Auth" value="JWT (HS256)" mono />
                <InfoRow label="Design System" value="Prism (MUI v7)" mono />
                <InfoRow label="Framework" value="Titan" mono />
                <InfoRow label="PM" value="Titan-PM (child processes)" mono />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Stack>
  );
}
