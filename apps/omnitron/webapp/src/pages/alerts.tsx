import { useState, useEffect, useCallback } from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Badge from '@mui/material/Badge';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';

import { AlertIcon, PlusIcon, RefreshIcon, CheckIcon, EditIcon, DeleteIcon } from 'src/assets/icons';
import { Breadcrumbs } from '@omnitron-dev/prism';
import { alerts } from 'src/netron/client';
import { timeAgo } from 'src/utils/formatters';
import { useStackContext } from 'src/hooks/use-stack-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertRule {
  id: string;
  name: string;
  expression: string;
  type: 'threshold' | 'anomaly' | 'absence' | 'composite';
  severity: 'critical' | 'warning' | 'info';
  enabled: boolean;
  createdAt: string;
}

interface ActiveAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  firedAt: string;
  acknowledged: boolean;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, 'error' | 'warning' | 'info'> = {
  critical: 'error',
  warning: 'warning',
  info: 'info',
};

// ---------------------------------------------------------------------------
// Create Alert Rule Dialog
// ---------------------------------------------------------------------------

interface CreateAlertRuleDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (rule: AlertRule) => void;
}

const RULE_TYPES: Array<{ value: AlertRule['type']; label: string }> = [
  { value: 'threshold', label: 'Threshold' },
  { value: 'anomaly', label: 'Anomaly' },
  { value: 'absence', label: 'Absence' },
  { value: 'composite', label: 'Composite' },
];

const SEVERITY_OPTIONS: Array<{ value: AlertRule['severity']; label: string }> = [
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

function CreateAlertRuleDialog({ open, onClose, onCreated }: CreateAlertRuleDialogProps) {
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [type, setType] = useState<AlertRule['type']>('threshold');
  const [severity, setSeverity] = useState<AlertRule['severity']>('warning');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setExpression('');
    setType('threshold');
    setSeverity('warning');
    setEnabled(true);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim() || !expression.trim()) {
      setError('Name and expression are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await alerts.createRule({ name: name.trim(), expression: expression.trim(), type, severity, enabled });
      onCreated(created as AlertRule);
      handleClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>New Alert Rule</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            size="small"
          />
          <TextField
            label="Expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            fullWidth
            required
            size="small"
            multiline
            rows={3}
            placeholder="e.g. cpu_percent > 90"
            helperText="Metric expression that triggers this alert"
          />
          <TextField
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as AlertRule['type'])}
            select
            fullWidth
            size="small"
          >
            {RULE_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AlertRule['severity'])}
            select
            fullWidth
            size="small"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
            label="Enable rule immediately"
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {saving ? 'Creating…' : 'Create Rule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'success' | 'warning' | 'error' | 'info' | 'primary';
  loading?: boolean;
}

function StatCard({ title, value, icon, color, loading }: StatCardProps) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {title}
            </Typography>
            {loading ? (
              <Skeleton width={60} height={40} />
            ) : (
              <Typography variant="h4">{value}</Typography>
            )}
          </Stack>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: (t) => alpha(t.palette[color].main, 0.12),
              color: `${color}.main`,
              display: 'flex',
            }}
          >
            {icon}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Alerts Page
// ---------------------------------------------------------------------------

export default function AlertsPage() {
  const { namespacePrefix, displayName } = useStackContext();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [activeAlerts, setActiveAlerts] = useState<ActiveAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [rulesList, alertsList] = await Promise.allSettled([
        alerts.listRules(),
        alerts.listActiveAlerts(),
      ]);

      if (rulesList.status === 'fulfilled') setRules(Array.isArray(rulesList.value) ? rulesList.value : []);
      if (alertsList.status === 'fulfilled') setActiveAlerts(Array.isArray(alertsList.value) ? alertsList.value : []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const firingCount = activeAlerts.filter((a) => !a.resolvedAt).length;
  const resolvedCount = activeAlerts.filter((a) => !!a.resolvedAt).length;

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await alerts.updateRule(ruleId, { enabled });
      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled } : r)));
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update rule');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await alerts.deleteRule(ruleId);
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (err: any) {
      setError(err?.message ?? 'Failed to delete rule');
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      await alerts.acknowledgeAlert(alertId);
      setActiveAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)),
      );
    } catch (err: any) {
      setError(err?.message ?? 'Failed to acknowledge alert');
    }
  };

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Alerts' }]}
        action={
          <Stack direction="row" spacing={1} alignItems="center">
            {firingCount > 0 && (
              <Badge badgeContent={firingCount} color="error">
                <Chip label="Firing" size="small" color="error" variant="outlined" />
              </Badge>
            )}
            <IconButton size="small" onClick={fetchData} title="Refresh">
              <RefreshIcon />
            </IconButton>
            <Button
              variant="contained"
              size="small"
              startIcon={<PlusIcon />}
              onClick={() => setCreateDialogOpen(true)}
            >
              New Rule
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Summary Cards */}
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Firing"
            value={firingCount}
            icon={<AlertIcon />}
            color={firingCount > 0 ? 'error' : 'success'}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Resolved"
            value={resolvedCount}
            icon={<CheckIcon />}
            color="success"
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard
            title="Total Rules"
            value={rules.length}
            icon={<AlertIcon />}
            color="primary"
            loading={loading}
          />
        </Grid>
      </Grid>

      {/* Active Alerts */}
      {activeAlerts.filter((a) => !a.resolvedAt).length > 0 && (
        <Card variant="outlined">
          <CardHeader
            title="Active Alerts"
            titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
            subheader={`${firingCount} alert${firingCount !== 1 ? 's' : ''} currently firing`}
            subheaderTypographyProps={{ variant: 'caption' }}
          />
          <CardContent sx={{ pt: 0 }}>
            <Stack spacing={1}>
              {activeAlerts
                .filter((a) => !a.resolvedAt)
                .map((alert) => (
                  <Stack
                    key={alert.id}
                    direction="row"
                    alignItems="center"
                    spacing={2}
                    sx={{
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: (t) =>
                        alpha(
                          t.palette[SEVERITY_COLORS[alert.severity] ?? 'info'].main,
                          0.08,
                        ),
                      border: 1,
                      borderColor: (t) =>
                        alpha(
                          t.palette[SEVERITY_COLORS[alert.severity] ?? 'info'].main,
                          0.2,
                        ),
                    }}
                  >
                    <Chip
                      label={alert.severity}
                      size="small"
                      color={SEVERITY_COLORS[alert.severity] ?? 'info'}
                      variant="filled"
                      sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 10, minWidth: 64 }}
                    />
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {alert.ruleName}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {alert.message}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
                      {timeAgo(alert.firedAt)}
                    </Typography>
                    {!alert.acknowledged && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => handleAcknowledge(alert.id)}
                        sx={{ minWidth: 0, px: 1.5, fontSize: 11 }}
                      >
                        Ack
                      </Button>
                    )}
                    {alert.acknowledged && (
                      <Chip label="Acked" size="small" variant="outlined" color="default" sx={{ fontSize: 10 }} />
                    )}
                  </Stack>
                ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* Alert Rules Table */}
      <Card variant="outlined">
        <CardHeader
          title="Alert Rules"
          titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }}
        />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Expression</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell align="center">Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                [...Array(3)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton width={80} height={20} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      No alert rules configured. Create a rule to get started.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((rule) => (
                  <TableRow
                    key={rule.id}
                    hover
                    sx={{
                      '&:last-child td': { borderBottom: 0 },
                      opacity: rule.enabled ? 1 : 0.5,
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {rule.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        {rule.expression}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={rule.type}
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: 'capitalize', fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={rule.severity}
                        size="small"
                        color={SEVERITY_COLORS[rule.severity] ?? 'default'}
                        variant="filled"
                        sx={{ textTransform: 'capitalize', fontWeight: 600, fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={rule.enabled}
                        onChange={(_, checked) => handleToggleRule(rule.id, checked)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Edit rule">
                          <IconButton size="small">
                            <EditIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete rule">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteRule(rule.id)}
                          >
                            <DeleteIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <CreateAlertRuleDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={(rule) => setRules((prev) => [...prev, rule])}
      />
    </Stack>
  );
}
