import { useEffect, useState } from 'react';
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
import { AdminDataTable, Alert, Breadcrumbs, ConfirmDialog, Skeleton, type ColumnDef } from '@omnitron-dev/prism';
import { alerts } from 'src/netron/client';
import { timeAgo } from 'src/utils/formatters';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { settledPair } from 'src/utils/settled-pair';
import {
  ALERT_EXPRESSION_HELP,
  ALERT_SEVERITIES,
  readAlertRuleFields,
  type AlertRuleFields,
} from '@omnitron-dev/omnitron/alerts';

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
// Alert Rule Dialog — a new rule, or a change to one
// ---------------------------------------------------------------------------

interface AlertRuleDialogProps {
  open: boolean;
  /** The rule to change; absent, a new one. */
  rule: AlertRule | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * One form for both. Checked by `readAlertRuleFields` — the function the
 * daemon runs on the same fields — so the form refuses what the daemon would,
 * with the same words. What a rule watches is read off its expression; the
 * type used to be chosen here, beside the expression that already said it,
 * and could be `log`, which the grammar has no form for.
 */
function AlertRuleDialog({ open, rule, onClose, onSaved }: AlertRuleDialogProps) {
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [severity, setSeverity] = useState<AlertRule['severity']>('warning');
  const [wait, setWait] = useState('');
  const [summary, setSummary] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A rule opened for editing fills the form; a new one empties it.
  useEffect(() => {
    if (!open) return;
    setName(rule?.name ?? '');
    setExpression(rule?.expression ?? '');
    setSeverity(rule?.severity ?? 'warning');
    setWait(rule?.forDuration ? String(rule.forDuration) : '');
    setSummary(rule?.summary ?? '');
    setEnabled(rule?.enabled ?? true);
    setError(null);
  }, [open, rule]);

  const handleSubmit = async () => {
    const { fields, problems } = readAlertRuleFields(
      {
        name,
        expression,
        severity,
        forDuration: wait.trim() === '' ? null : Number(wait),
        summary,
        enabled,
      },
      false,
    );
    if (problems.length > 0) {
      setError(problems.join('; '));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const checked = fields as AlertRuleFields;
      if (rule) await alerts.updateRule({ id: rule.id, ...checked });
      else await alerts.createRule(checked);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save the rule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{rule ? 'Edit Alert Rule' : 'New Alert Rule'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth required size="small" />
          <TextField
            label="Expression"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            fullWidth
            required
            size="small"
            placeholder="e.g. app.main.cpu > 90"
            helperText={`Supported forms: ${ALERT_EXPRESSION_HELP}`}
          />
          <TextField
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AlertRule['severity'])}
            select
            fullWidth
            size="small"
          >
            {[...ALERT_SEVERITIES].reverse().map((s) => (
              <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Fire after (seconds)"
            value={wait}
            onChange={(e) => setWait(e.target.value)}
            fullWidth
            size="small"
            inputMode="numeric"
            helperText="How long the condition must hold before the alert fires. Empty fires at once."
          />
          <TextField
            label="Summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            fullWidth
            size="small"
            helperText="The sentence the alert is listed and notified with. Empty lists the expression and its value."
          />
          <FormControlLabel control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />} label="Enabled" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {saving ? 'Saving…' : rule ? 'Save Rule' : 'Create Rule'}
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
  // No stack context here on purpose. An `AlertRule` is an expression over
  // metrics with no app field, and an `ActiveAlert` names the rule that fired,
  // so there is nothing for `namespacePrefix` to narrow. The page used to pull
  // it and `displayName` and use neither, which reads like scoping that
  // happens somewhere below and does not.
  // Absent: no dialog. `null`: a new rule. A rule: that rule, being changed.
  const [editing, setEditing] = useState<AlertRule | null | undefined>(undefined);

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

  // The list is firing alerts only; «resolved» counted from it was always 0.
  const firingCount = activeAlerts.length;
  const acknowledgedCount = activeAlerts.filter((a) => a.acknowledged).length;

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await alerts.updateRule({ id: ruleId, enabled });
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
      // Who acknowledged is recorded by the daemon, from the session.
      await alerts.acknowledgeAlert({ alertId });
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
      key: 'forDuration',
      header: 'Fires after',
      render: (rule) => (
        <Typography variant="caption">{rule.forDuration ? `${rule.forDuration}s held` : 'at once'}</Typography>
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
            <IconButton size="small" onClick={() => setEditing(rule)}>
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
              onClick={() => setEditing(null)}
            >
              New Rule
            </Button>
          </Stack>
        }
      />
      {(error || actionError || partialFailure) && (
        <Alert closable severity="warning" variant="outlined" onClose={() => setActionError(null)}>
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
            title="Acknowledged"
            value={acknowledgedCount}
            icon={<CheckIcon />}
            color={acknowledgedCount < firingCount ? 'warning' : 'success'}
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
      {firingCount > 0 && (
        <Card variant="outlined">
          <CardHeader slotProps={{ subheader: { variant: 'caption' }, title: { variant: 'subtitle1', fontWeight: 600 } }}
            title="Active Alerts"
            subheader={`${firingCount} alert${firingCount !== 1 ? 's' : ''} currently firing`}
          />
          <CardContent sx={{ pt: 0 }}>
            <Stack spacing={1}>
              {activeAlerts.map((alert) => (
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
        <CardHeader slotProps={{ title: { variant: 'subtitle1', fontWeight: 600 } }}
          title="Alert Rules"
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
      <AlertRuleDialog
        open={editing !== undefined}
        rule={editing ?? null}
        onClose={() => setEditing(undefined)}
        onSaved={() => void fetchData()}
      />
    </Stack>
  );
}
