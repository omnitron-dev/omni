import { useState } from 'react';
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
import Alert from '@mui/material/Alert';
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
import { AdminDataTable, Breadcrumbs, ConfirmDialog, Skeleton, type ColumnDef } from '@omnitron-dev/prism';
import { alerts } from 'src/netron/client';
import { timeAgo } from 'src/utils/formatters';
import { useStackContext } from 'src/hooks/use-stack-context';
import { useAuthStore } from 'src/auth/store';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { settledPair } from 'src/utils/settled-pair';
import { isAlertExpressionParseable, ALERT_EXPRESSION_HELP } from '@omnitron-dev/omnitron/alerts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Shapes come from the daemon's DTO module — the page used to declare its
// own, and they had drifted: it invented rule types ('threshold' | 'anomaly' |
// 'absence' | 'composite') the server has never accepted (it takes
// 'metric' | 'log' | 'health'), so every rule created here was rejected.
type AlertRule = import('@omnitron-dev/omnitron/dto/services').AlertRule;
type ActiveAlert = import('@omnitron-dev/omnitron/dto/services').ActiveAlert;

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
  { value: 'metric', label: 'Metric' },
  { value: 'log', label: 'Log' },
  { value: 'health', label: 'Health' },
];

const SEVERITY_OPTIONS: Array<{ value: AlertRule['severity']; label: string }> = [
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

function CreateAlertRuleDialog({ open, onClose, onCreated }: CreateAlertRuleDialogProps) {
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [type, setType] = useState<AlertRule['type']>('metric');
  const [severity, setSeverity] = useState<AlertRule['severity']>('warning');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setExpression('');
    setType('metric');
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
    // Rejected here rather than accepted and stored. The evaluator answers
    // an expression it cannot read with "not firing" — the same answer a
    // healthy platform gives — so a rule outside the grammar is created
    // successfully, shows enabled and green, and catches nothing.
    if (!isAlertExpressionParseable(expression)) {
      setError(`The evaluator cannot read this expression. Supported forms: ${ALERT_EXPRESSION_HELP}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await alerts.createRule({ name: name.trim(), expression: expression.trim(), type, severity, enabled });
      onCreated(created);
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
            placeholder="e.g. app.main.cpu > 90"
            helperText={`Supported forms: ${ALERT_EXPRESSION_HELP}`}
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
        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <Stack spacing={0.5}>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data, loading, error, refresh: fetchData } = usePolledResource(
    async () => {
      const { first, second, partialFailure } = await settledPair<AlertRule[], ActiveAlert[]>(
        [alerts.getRules(), alerts.getActiveAlerts()],
        [[], []]
      );
      return { rules: first, activeAlerts: second, partialFailure };
    },
    { intervalMs: 15_000 }
  );

  // Failures from a button press are a different thing from a stale poll:
  // one says "what you just asked for did not happen", the other "this view
  // may be behind".
  const [actionError, setActionError] = useState<string | null>(null);
  // Deleting an alert rule used to happen on one click. The rule an operator
  // removes by accident is the one that would have told them about the next
  // incident, and nothing here says which rule is about to go.
  const [confirmDeleteRule, setConfirmDeleteRule] = useState<string | null>(null);
  const [rulePage, setRulePage] = useState(0);
  const [rulePageSize, setRulePageSize] = useState(25);

  const rules = data?.rules ?? [];
  const activeAlerts = data?.activeAlerts ?? [];
  const partialFailure = data?.partialFailure ?? null;

  const firingCount = activeAlerts.filter((a) => !a.resolvedAt).length;
  const resolvedCount = activeAlerts.filter((a) => !!a.resolvedAt).length;

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await alerts.updateRule({ id: ruleId, updates: { enabled } });
      // Re-read rather than patching the local copy: the rule the server
      // stored is what should be on screen, and the optimistic edit this
      // replaces could not be told apart from a write that silently failed.
      await fetchData();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to update rule');
    }
  };

  const handleDeleteRule = async () => {
    const ruleId = confirmDeleteRule;
    if (!ruleId) return;
    try {
      await alerts.deleteRule({ id: ruleId });
      setConfirmDeleteRule(null);
      await fetchData();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to delete rule');
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      // The server records WHO acknowledged; it is part of the audit trail.
      const actor = useAuthStore.getState().user?.username ?? 'unknown';
      await alerts.acknowledgeAlert({ alertId, acknowledgedBy: actor });
      await fetchData();
    } catch (err: any) {
      setActionError(err?.message ?? 'Failed to acknowledge alert');
    }
  };

  const ruleRows = rules.slice(rulePage * rulePageSize, rulePage * rulePageSize + rulePageSize);

  const ruleColumns: ColumnDef<AlertRule>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (rule) => (
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {rule.name}
        </Typography>
      ),
    },
    {
      key: 'expression',
      header: 'Expression',
      render: (rule) => (
        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
          {rule.expression}
        </Typography>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (rule) => (
        <Chip
          label={rule.type}
          size="small"
          variant="outlined"
          sx={{ textTransform: 'capitalize', fontSize: 11 }}
        />
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      render: (rule) => (
        <Chip
          label={rule.severity}
          size="small"
          color={SEVERITY_COLORS[rule.severity] ?? 'default'}
          variant="filled"
          sx={{ textTransform: 'capitalize', fontWeight: 600, fontSize: 11 }}
        />
      ),
    },
    {
      key: 'enabled',
      header: 'Enabled',
      align: 'center',
      render: (rule) => (
        <Switch
          size="small"
          checked={rule.enabled}
          onChange={(_, checked) => handleToggleRule(rule.id, checked)}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (rule) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
          <Tooltip title="Edit rule">
            <IconButton size="small">
              <EditIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete rule">
            <IconButton size="small" color="error" onClick={() => setConfirmDeleteRule(rule.id)}>
              <DeleteIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Breadcrumbs
        links={[{ name: 'Alerts' }]}
        action={
          <Stack direction="row" spacing={1} sx={{
            alignItems: "center"
          }}>
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
      {(error || actionError || partialFailure) && (
        <Alert severity="warning" variant="outlined" onClose={() => setActionError(null)}>
          {actionError ?? error ?? `Some data is unavailable: ${partialFailure}`}
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
                    spacing={2}
                    sx={{
                      alignItems: "center",
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
                        )
                    }}>
                    <Chip
                      label={alert.severity}
                      size="small"
                      color={SEVERITY_COLORS[alert.severity] ?? 'info'}
                      variant="filled"
                      sx={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 10, minWidth: 64 }}
                    />
                    <Stack sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{
                        fontWeight: 600
                      }}>
                        {alert.ruleName}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                        {alert.message}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.disabled",
                        flexShrink: 0
                      }}>
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
        <AdminDataTable<AlertRule>
          columns={ruleColumns}
          data={ruleRows}
          total={rules.length}
          loading={loading}
          loadError={error ?? partialFailure ?? null}
          emptyMessage="No alert rules configured. Create a rule to get started."
          rowKey={(rule) => rule.id}
          // A disabled rule is still worth reading, just not acting on.
          rowSx={(rule) => ({ opacity: rule.enabled ? 1 : 0.5 })}
          page={rulePage}
          pageSize={rulePageSize}
          onPageChange={setRulePage}
          onPageSizeChange={(size) => {
            setRulePageSize(size);
            setRulePage(0);
          }}
          dense
        />
      </Card>
      <ConfirmDialog
        open={confirmDeleteRule !== null}
        onClose={() => setConfirmDeleteRule(null)}
        onConfirm={handleDeleteRule}
        title="Delete alert rule?"
        content={
          <>
            <b>{rules.find((r) => r.id === confirmDeleteRule)?.name ?? confirmDeleteRule}</b> will stop
            firing. Alerts it has already raised are kept.
          </>
        }
        confirmLabel="Delete"
        confirmColor="error"
      />
      <CreateAlertRuleDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={() => void fetchData()}
      />
    </Stack>
  );
}
