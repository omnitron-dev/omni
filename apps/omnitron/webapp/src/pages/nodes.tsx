/**
 * Nodes Page — Infrastructure node management
 *
 * Card layout: PING + OMNITRON indicators, uptime bars from PG history.
 * Uptime bars: vertical 4px segments, green→red by uptime %, two rows.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Divider from '@mui/material/Divider';
import { keyframes, useTheme, type Theme } from '@mui/material/styles';

import { Breadcrumbs, useSnackbar } from '@omnitron/prism';
import { nodes as nodesRpc } from 'src/netron/client';
import {
  PlusIcon,
  NodesIcon,
  SettingsIcon,
  DeleteIcon,
  RefreshIcon,
  ChipIcon,
} from 'src/assets/icons';
/** One bar segment = 24 hours. Checks run every minute = 1440 checks per segment. */
const UPTIME_BUCKET_MS = 86_400_000; // 24h

// =============================================================================
// Types
// =============================================================================

interface INode {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  sshAuthMethod: 'password' | 'key';
  sshPrivateKey?: string;
  hasPassphrase?: boolean;
  hasPassword?: boolean;
  runtime: 'node' | 'bun';
  daemonPort: number;
  tags: string[];
  isLocal: boolean;
  createdAt: string;
  updatedAt: string;
}

interface INodeStatus {
  nodeId: string;
  pingReachable: boolean;
  pingLatencyMs: number | null;
  pingError?: string;
  sshConnected: boolean;
  sshLatencyMs: number | null;
  sshError?: string;
  omnitronConnected: boolean;
  omnitronVersion?: string;
  omnitronPid?: number;
  omnitronUptime?: number;
  omnitronRole?: string;
  omnitronError?: string;
  os?: { platform: string; arch: string; hostname: string; release: string };
  checkedAt: string;
}

interface INodeWithStatus extends INode { status: INodeStatus | null }
interface SshKeyInfo { name: string; path: string; type: string }

/** Backend UptimeBucket — per-interval aggregation */
interface UptimeBucket {
  t: string;
  /** 0.0–1.0 uptime pct, -1 = no data */
  ping: number;
  /** 0.0–1.0 uptime pct, -1 = no data / not installed */
  omnitron: number;
  checks: number;
}

// =============================================================================
// Animations
// =============================================================================

const spin = keyframes`
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.3; }
`;

// =============================================================================
// Status Dot
// =============================================================================

type DotState = 'online' | 'offline' | 'unchecked' | 'checking' | 'not-installed';

function StatusDot({ state, label, tooltip }: { state: DotState; label: string; tooltip?: string }) {
  const colors: Record<DotState, string> = {
    online: 'success.main', offline: 'error.main', unchecked: 'text.disabled',
    checking: 'warning.main', 'not-installed': 'text.disabled',
  };
  const texts: Record<DotState, string> = {
    online: 'Connected', offline: 'Offline', unchecked: 'Not checked',
    checking: 'Checking...', 'not-installed': 'Not installed',
  };

  return (
    <Tooltip title={tooltip ?? texts[state]} arrow>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%', bgcolor: colors[state], flexShrink: 0,
          ...(state === 'checking' && { animation: `${pulse} 1s ease-in-out infinite` }),
          ...(state === 'not-installed' && { border: '1px dashed', borderColor: 'text.disabled', bgcolor: 'transparent' }),
        }} />
        <Typography variant="caption" color="text.secondary" noWrap>{label}</Typography>
      </Stack>
    </Tooltip>
  );
}

// =============================================================================
// Uptime Bar — vertical 4px segments, green→red gradient
// =============================================================================

/**
 * Precise uptime → color mapping via HSL interpolation.
 *
 * pct = ratio of successful checks in this bucket (0.0 = all failed, 1.0 = all passed).
 * Maps to hue: 0° (red) → 120° (green) through yellow/orange.
 * Saturation and lightness extracted from theme success/error colors.
 */
function uptimeColor(pct: number, theme: Theme): string {
  if (pct < 0) return theme.palette.action.disabledBackground; // no data

  // Parse theme colors to HSL for proper interpolation
  const gHsl = hexToHsl(theme.palette.success.main);
  const rHsl = hexToHsl(theme.palette.error.main);

  // Lerp H/S/L — hue goes red(~0°) → green(~120°) linearly
  const h = rHsl[0] + (gHsl[0] - rHsl[0]) * pct;
  const s = rHsl[1] + (gHsl[1] - rHsl[1]) * pct;
  const l = rHsl[2] + (gHsl[2] - rHsl[2]) * pct;

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

/** Convert hex color (#rrggbb) to [h, s, l] */
function hexToHsl(hex: string): [number, number, number] {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = ((b - r) / d + 2);
  else h = ((r - g) / d + 4);
  h *= 60;

  return [h, s * 100, l * 100];
}

/**
 * UptimeStrip — Reusable uptime visualization component.
 *
 * Renders vertical colored segments (green→red by uptime %).
 * Dynamically calculates how many segments fit based on container width.
 *
 * Props:
 *   data        — array of { t, [metric]: 0.0–1.0 | -1 }
 *   metric      — key in data to read uptime from
 *   label       — strip label (e.g. "PING")
 *   segWidth    — segment width in px (default: 6)
 *   gap         — gap between segments in px (default: 4)
 *   height      — strip height in px (default: 10)
 */
function UptimeStrip<T extends Record<string, any>>({
  data,
  metric,
  label,
  segWidth = 6,
  gap = 4,
  height = 10,
}: {
  data: T[];
  metric: keyof T & string;
  label: string;
  segWidth?: number;
  gap?: number;
  height?: number;
}) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const calc = () => {
      const w = el.clientWidth;
      // segments: n * segWidth + (n-1) * gap <= w  →  n <= (w + gap) / (segWidth + gap)
      setVisibleCount(Math.max(1, Math.floor((w + gap) / (segWidth + gap))));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [segWidth, gap]);

  // Pad data to fill visible area: take last N from data, pad front with empty
  const segments: Array<{ val: number; time: string; checks?: number }> = [];
  if (visibleCount > 0) {
    const tail = data.slice(-visibleCount);
    // Left-pad with empty (no-data) segments so the strip is always full width
    for (let i = 0; i < visibleCount - tail.length; i++) {
      segments.push({ val: -1, time: '' });
    }
    for (const entry of tail) {
      const val = entry[metric] as number;
      const time = entry.t ? new Date(entry.t as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      segments.push({ val, time, checks: entry.checks as number | undefined });
    }
  }

  // Overall uptime %
  const withData = segments.filter((s) => s.val >= 0);
  const avgPct = withData.length > 0
    ? Math.round((withData.reduce((sum, s) => sum + s.val, 0) / withData.length) * 100)
    : -1;

  return (
    <Stack spacing={0.25}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        {avgPct >= 0 && (
          <Typography variant="caption" sx={{ fontSize: 9, color: avgPct >= 95 ? 'success.main' : avgPct >= 50 ? 'warning.main' : 'error.main' }}>
            {avgPct}%
          </Typography>
        )}
      </Stack>
      <Stack ref={containerRef} direction="row" sx={{ height, gap: `${gap}px` }}>
        {segments.map((seg, i) => {
          const bg = uptimeColor(seg.val, theme);
          const tip = seg.val < 0
            ? (seg.time ? `${seg.time} — no data` : 'No data')
            : `${seg.time} — ${Math.round(seg.val * 100)}% up${seg.checks != null ? ` (${seg.checks} checks)` : ''}`;
          return (
            <Tooltip key={i} title={tip} arrow>
              <Box sx={{
                width: segWidth, minWidth: segWidth, height: '100%', bgcolor: bg,
                borderRadius: '2px',
                transition: 'opacity 0.15s',
                '&:hover': { opacity: 0.6 },
              }} />
            </Tooltip>
          );
        })}
      </Stack>
    </Stack>
  );
}

// =============================================================================
// Omnitron dot state
// =============================================================================

function getOmnitronDotState(status: INodeStatus | null, isLocal: boolean): { state: DotState; tooltip: string } {
  if (!status) return { state: 'unchecked', tooltip: 'Not checked' };
  if (isLocal) {
    return status.omnitronConnected
      ? { state: 'online', tooltip: `v${status.omnitronVersion ?? '?'} PID ${status.omnitronPid ?? '?'}` }
      : { state: 'offline', tooltip: status.omnitronError ?? 'Not running' };
  }
  if (status.omnitronConnected) return { state: 'online', tooltip: `v${status.omnitronVersion ?? '?'} (${status.omnitronRole ?? '?'})` };
  // SSH not connected → can't know omnitron state, show as unchecked
  if (!status.sshConnected) return { state: 'unchecked', tooltip: 'Waiting for SSH connection' };
  const err = status.omnitronError ?? '';
  if (/not found|command not found|no such file|ENOENT/i.test(err)) return { state: 'not-installed', tooltip: 'Not installed on this node' };
  return { state: 'offline', tooltip: err || 'Not running' };
}

// =============================================================================
// Node Card
// =============================================================================

/** Segment sizing constants */
const SEG_WIDTH = 6;
const SEG_GAP = 4;
const SEG_HEIGHT = 10;

function NodeCard({
  node, onEdit, onRemove, onCheckSsh, checking, uptimeData,
}: {
  node: INodeWithStatus;
  onEdit: (n: INodeWithStatus) => void;
  onRemove: (id: string) => void;
  onCheckSsh: (id: string) => void;
  checking: boolean;
  uptimeData: UptimeBucket[];
}) {
  const { status } = node;
  // PING/OMNITRON dots reflect periodic worker checks — NOT the SSH button state
  const omnState = getOmnitronDotState(status, node.isLocal);
  const pingState: DotState = status?.pingReachable == null ? 'unchecked'
    : status.pingReachable ? 'online' : 'offline';

  return (
    <Card sx={{
      height: '100%', display: 'flex', flexDirection: 'column',
      transition: 'box-shadow 0.2s', '&:hover': { boxShadow: (t) => t.shadows[8] },
    }}>
      <CardContent sx={{ pb: '12px !important', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" mb={1.5}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
            {node.isLocal
              ? <ChipIcon sx={{ fontSize: 24, color: 'primary.main', flexShrink: 0 }} />
              : <NodesIcon sx={{ fontSize: 24, color: 'text.secondary', flexShrink: 0 }} />}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>{node.name}</Typography>
              <Typography variant="caption" color="text.disabled" noWrap>
                {node.host}{node.isLocal ? '' : `:${node.sshPort}`}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={0}>
            {!node.isLocal && (
              <Tooltip title={checking ? 'Checking...' : 'Check SSH connection'}>
                <span>
                  <IconButton size="small" onClick={() => onCheckSsh(node.id)} disabled={checking}>
                    <RefreshIcon sx={{ fontSize: 18, ...(checking && { animation: `${spin} 1s linear infinite` }) }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {!node.isLocal && (
              <>
                <Tooltip title="Edit"><IconButton size="small" onClick={() => onEdit(node)}><SettingsIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
                <Tooltip title="Remove"><IconButton size="small" onClick={() => onRemove(node.id)} color="error"><DeleteIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
              </>
            )}
          </Stack>
        </Stack>

        {/* Status dots: PING + OMNITRON */}
        <Stack direction="row" spacing={2} mb={1.5}>
          {node.isLocal ? (
            <StatusDot state={omnState.state} label="OMNITRON" tooltip={omnState.tooltip} />
          ) : (
            <>
              <StatusDot state={pingState} label="PING"
                tooltip={status?.pingReachable ? `${status.pingLatencyMs ?? '?'}ms` : status?.pingError ?? 'Not checked'} />
              <StatusDot state={omnState.state} label="OMNITRON" tooltip={omnState.tooltip} />
            </>
          )}
        </Stack>

        <Divider sx={{ mb: 1.5 }} />

        {/* Details */}
        <Stack spacing={0.5}>
          <DetailRow label="Runtime" value={node.runtime} />
          <DetailRow label="Daemon Port" value={String(node.daemonPort)} />
          {!node.isLocal && <DetailRow label="SSH User" value={node.sshUser} />}
          {status?.os && <DetailRow label="OS" value={`${status.os.platform} ${status.os.arch}`} />}
          {status?.omnitronUptime != null && status.omnitronUptime > 0 && (
            <DetailRow label="Uptime" value={formatUptime(status.omnitronUptime)} />
          )}
        </Stack>

        {node.tags.length > 0 && (
          <Stack direction="row" spacing={0.5} mt={1.5} flexWrap="wrap" useFlexGap>
            {node.tags.map((tag) => (
              <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ height: 22, fontSize: 11 }} />
            ))}
          </Stack>
        )}

        {/* Uptime bars — remote nodes only */}
        {!node.isLocal && (
          <Box sx={{ mt: 'auto', pt: 1.5 }}>
            <Stack spacing={0.75}>
              <UptimeStrip data={uptimeData} metric="ping" label="PING" segWidth={SEG_WIDTH} gap={SEG_GAP} height={SEG_HEIGHT} />
              <UptimeStrip data={uptimeData} metric="omnitron" label="OMNITRON" segWidth={SEG_WIDTH} gap={SEG_GAP} height={SEG_HEIGHT} />
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="caption" color="text.disabled">{label}</Typography>
      <Typography variant="caption" fontWeight={500}>{value}</Typography>
    </Stack>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// =============================================================================
// Add/Edit Dialog
// =============================================================================

interface NodeFormData {
  name: string; host: string; sshPort: number; sshUser: string;
  sshAuthMethod: 'password' | 'key'; sshPrivateKey: string; sshPassphrase: string; sshPassword: string;
  runtime: 'node' | 'bun'; daemonPort: number; tags: string;
}

const INITIAL_FORM: NodeFormData = {
  name: '', host: '', sshPort: 22, sshUser: 'root', sshAuthMethod: 'key',
  sshPrivateKey: '', sshPassphrase: '', sshPassword: '', runtime: 'node', daemonPort: 9700, tags: '',
};

function NodeDialog({ open, onClose, onSubmit, editNode, sshKeys, loading }: {
  open: boolean; onClose: () => void; onSubmit: (d: NodeFormData) => void;
  editNode: INodeWithStatus | null; sshKeys: SshKeyInfo[]; loading: boolean;
}) {
  const [form, setForm] = useState<NodeFormData>(INITIAL_FORM);
  useEffect(() => {
    if (!open) return;
    if (editNode) {
      setForm({
        name: editNode.name, host: editNode.host, sshPort: editNode.sshPort,
        sshUser: editNode.sshUser, sshAuthMethod: editNode.sshAuthMethod,
        sshPrivateKey: editNode.sshPrivateKey ?? '', sshPassphrase: '', sshPassword: '',
        runtime: editNode.runtime, daemonPort: editNode.daemonPort, tags: editNode.tags.join(', '),
      });
    } else {
      setForm({ ...INITIAL_FORM, sshPrivateKey: sshKeys[0]?.path ?? '' });
    }
  }, [editNode, sshKeys, open]);

  const up = (f: keyof NodeFormData, v: string | number) => setForm((p) => ({ ...p, [f]: v }));
  const isEdit = !!editNode;
  const canSubmit = form.name.trim() && form.host.trim();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? `Edit "${editNode.name}"` : 'Add Node'}</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Stack spacing={2.5} mt={1}>
          <TextField label="Name" value={form.name} onChange={(e) => up('name', e.target.value)} fullWidth placeholder="production-server-1" autoFocus />
          <Stack direction="row" spacing={2}>
            <TextField label="Host" value={form.host} onChange={(e) => up('host', e.target.value)} fullWidth placeholder="192.168.1.100" />
            <TextField label="SSH Port" value={form.sshPort} onChange={(e) => up('sshPort', parseInt(e.target.value, 10) || 22)} sx={{ width: 120 }} type="number" />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="SSH User" value={form.sshUser} onChange={(e) => up('sshUser', e.target.value)} fullWidth />
            <FormControl sx={{ minWidth: 160 }}>
              <InputLabel>Auth Method</InputLabel>
              <Select value={form.sshAuthMethod} label="Auth Method" onChange={(e) => up('sshAuthMethod', e.target.value)}>
                <MenuItem value="key">SSH Key</MenuItem>
                <MenuItem value="password">Password</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          {form.sshAuthMethod === 'key' ? (
            <>
              <FormControl fullWidth>
                <InputLabel>SSH Private Key</InputLabel>
                <Select value={form.sshPrivateKey} label="SSH Private Key" onChange={(e) => up('sshPrivateKey', e.target.value as string)}>
                  {sshKeys.map((key) => (
                    <MenuItem key={key.path} value={key.path}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                        <Typography variant="body2" fontWeight={500}>{key.name}</Typography>
                        <Chip label={key.type} size="small" sx={{ height: 20, fontSize: 11 }} />
                        <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto !important' }} noWrap>{key.path}</Typography>
                      </Stack>
                    </MenuItem>
                  ))}
                  {sshKeys.length === 0 && <MenuItem disabled><Typography variant="body2" color="text.secondary">No SSH keys found</Typography></MenuItem>}
                </Select>
              </FormControl>
              <TextField
                label="Key Passphrase"
                value={form.sshPassphrase}
                onChange={(e) => up('sshPassphrase', e.target.value)}
                fullWidth
                type="password"
                placeholder={editNode?.hasPassphrase ? 'Encrypted — leave empty to keep' : 'Leave empty if key is not encrypted'}
                size="small"
                helperText={editNode?.hasPassphrase ? 'Passphrase is stored encrypted. Enter new value to change.' : undefined}
              />
            </>
          ) : (
            <TextField label="SSH Password" value={form.sshPassword} onChange={(e) => up('sshPassword', e.target.value)} fullWidth type="password" />
          )}
          <Divider />
          <Stack direction="row" spacing={2}>
            <FormControl sx={{ minWidth: 140 }}>
              <InputLabel>Runtime</InputLabel>
              <Select value={form.runtime} label="Runtime" onChange={(e) => up('runtime', e.target.value)}>
                <MenuItem value="node">Node.js</MenuItem>
                <MenuItem value="bun">Bun</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Daemon Port" value={form.daemonPort} onChange={(e) => up('daemonPort', parseInt(e.target.value, 10) || 9700)} sx={{ width: 140 }} type="number" />
            <TextField label="Tags" value={form.tags} onChange={(e) => up('tags', e.target.value)} fullWidth placeholder="production, gpu" helperText="Comma-separated" />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">Cancel</Button>
        <Button variant="contained" onClick={() => onSubmit(form)} disabled={!canSubmit || loading}>{isEdit ? 'Save' : 'Add Node'}</Button>
      </DialogActions>
    </Dialog>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function NodesPage() {
  const [nodeList, setNodeList] = useState<INodeWithStatus[]>([]);
  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editNode, setEditNode] = useState<INodeWithStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uptimeBars, setUptimeBars] = useState<Record<string, UptimeBucket[]>>({});

  const fetchNodes = useCallback(async () => {
    try {
      const list: INodeWithStatus[] = await nodesRpc.listNodes();
      setNodeList(list);
      return list;
    } catch { setNodeList([]); return []; }
    finally { setLoading(false); }
  }, []);

  const fetchUptimeBars = useCallback(async (nodes: INodeWithStatus[]) => {
    const results: Record<string, UptimeBucket[]> = {};
    await Promise.allSettled(nodes.map(async (node) => {
      try {
        // Request more buckets than can fit — UptimeStrip will trim to visible width
        results[node.id] = await nodesRpc.getUptimeBar({ nodeId: node.id, bucketCount: 200, intervalMs: UPTIME_BUCKET_MS });
      } catch { results[node.id] = []; }
    }));
    setUptimeBars(results);
  }, []);

  const fetchSshKeys = useCallback(async () => {
    try { setSshKeys(await nodesRpc.listSshKeys()); } catch { setSshKeys([]); }
  }, []);

  useEffect(() => {
    (async () => { const n = await fetchNodes(); await fetchUptimeBars(n); })();
    fetchSshKeys();
    const iv = setInterval(async () => { const n = await fetchNodes(); await fetchUptimeBars(n); }, 30_000);
    return () => clearInterval(iv);
  }, [fetchNodes, fetchUptimeBars, fetchSshKeys]);

  const snackbar = useSnackbar();

  const handleCheckSsh = useCallback(async (id: string) => {
    const node = nodeList.find((n) => n.id === id);
    const label = node?.name ?? id;
    setCheckingId(id);
    try {
      // checkNodeStatus triggers a full check via the worker — we only care about SSH result
      const result: INodeStatus = await nodesRpc.checkNodeStatus({ id });
      if (result.sshConnected) {
        const latency = result.sshLatencyMs != null ? ` (${result.sshLatencyMs}ms)` : '';
        snackbar.success(`${label}: SSH connected${latency}`);
      } else {
        snackbar.error(`${label}: SSH failed — ${result.sshError ?? 'Connection refused'}`);
      }
    } catch (err: any) {
      snackbar.error(`${label}: ${err?.message ?? 'Check failed'}`);
    } finally {
      setCheckingId(null);
    }
  }, [nodeList, snackbar]);

  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const confirmRemoveNode = nodeList.find((n) => n.id === confirmRemoveId);

  const handleRemove = useCallback(async () => {
    if (!confirmRemoveId) return;
    try { await nodesRpc.removeNode({ id: confirmRemoveId }); await fetchNodes(); }
    catch (err) { console.error('Failed to remove node:', err); }
    finally { setConfirmRemoveId(null); }
  }, [confirmRemoveId, fetchNodes]);

  const handleOpenAdd = useCallback(() => { setEditNode(null); setDialogOpen(true); }, []);
  const handleOpenEdit = useCallback((n: INodeWithStatus) => { setEditNode(n); setDialogOpen(true); }, []);
  const handleCloseDialog = useCallback(() => { setDialogOpen(false); setEditNode(null); }, []);

  const handleSubmit = useCallback(async (form: NodeFormData) => {
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(), host: form.host.trim(), sshPort: form.sshPort,
        sshUser: form.sshUser.trim(), sshAuthMethod: form.sshAuthMethod,
        sshPrivateKey: form.sshAuthMethod === 'key' ? form.sshPrivateKey : undefined,
        sshPassphrase: form.sshAuthMethod === 'key' && form.sshPassphrase ? form.sshPassphrase : undefined,
        sshPassword: form.sshAuthMethod === 'password' ? form.sshPassword : undefined,
        runtime: form.runtime, daemonPort: form.daemonPort,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (editNode) await nodesRpc.updateNode({ id: editNode.id, ...payload });
      else await nodesRpc.addNode(payload);
      handleCloseDialog();
      await fetchNodes();
    } catch (err) { console.error('Failed to save node:', err); }
    finally { setSubmitting(false); }
  }, [editNode, fetchNodes, handleCloseDialog]);

  const sorted = [...nodeList].sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Stack spacing={3}>
      <Breadcrumbs
        links={[{ name: 'Nodes' }]}
        action={
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon sx={{ fontSize: 18 }} />}
              onClick={async () => { const n = await fetchNodes(); await fetchUptimeBars(n); }}>
              Refresh
            </Button>
            <Button variant="contained" size="small" startIcon={<PlusIcon sx={{ fontSize: 18 }} />} onClick={handleOpenAdd}>
              Add Node
            </Button>
          </Stack>
        }
      />

      {loading ? (
        <Grid container spacing={3}>
          {[1, 2, 3].map((i) => <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}><Skeleton variant="rounded" height={300} /></Grid>)}
        </Grid>
      ) : (
        <Grid container spacing={3}>
          {sorted.map((node) => (
            <Grid key={node.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <NodeCard node={node} onEdit={handleOpenEdit} onRemove={setConfirmRemoveId}
                onCheckSsh={handleCheckSsh} checking={checkingId === node.id}
                uptimeData={uptimeBars[node.id] ?? []} />
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={!!confirmRemoveId} onClose={() => setConfirmRemoveId(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Remove Node</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Remove <strong>{confirmRemoveNode?.name ?? confirmRemoveId}</strong>? This cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRemoveId(null)} color="inherit">Cancel</Button>
          <Button onClick={handleRemove} color="error" variant="contained">Remove</Button>
        </DialogActions>
      </Dialog>

      <NodeDialog open={dialogOpen} onClose={handleCloseDialog} onSubmit={handleSubmit}
        editNode={editNode} sshKeys={sshKeys} loading={submitting} />
    </Stack>
  );
}
