/**
 * Omnitron Console — Settings Page
 *
 * Tabbed layout following portal pattern (Prism Tabs + TabPanel):
 * - General: Profile, Daemon configuration, About
 * - Security: Change password
 * - Sessions: Active sessions with revoke
 * - Appearance: Theme, sidebar, density
 * - Notifications: Desktop, sound, severity filter
 */

import { useState, useEffect, useCallback } from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControl from '@mui/material/FormControl';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';

import { EyeIcon, DeleteIcon } from 'src/assets/icons';

import { Tabs, TabPanel } from '@omnitron/prism';
import { useAuthStore } from 'src/auth/store';
import { auth, getSessionId, nodes as nodesRpc } from 'src/netron/client';
import { formatDateShort, timeAgo } from 'src/utils/formatters';

import type { OmnitronActiveSession } from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Shared
// =============================================================================

const LS_THEME_MODE = 'omnitron_theme_mode';
const LS_SIDEBAR_COLLAPSED = 'omnitron_sidebar_collapsed';
const LS_COMPACT_DENSITY = 'omnitron_compact_density';
const LS_DESKTOP_NOTIFICATIONS = 'omnitron_desktop_notifications';
const LS_SOUND_ALERTS = 'omnitron_sound_alerts';
const LS_ALERT_SEVERITY = 'omnitron_alert_severity';

function readLocalBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === 'true';
}

function writeLocalBool(key: string, value: boolean): void {
  localStorage.setItem(key, String(value));
}

const cardSx = { borderRadius: 2 } as const;
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

// =============================================================================
// General Tab
// =============================================================================

function GeneralSection() {
  const user = useAuthStore((s) => s.user);

  if (!user) return null;

  return (
    <Card variant="outlined" sx={{ ...cardSx, maxWidth: 480 }}>
      <CardHeader title="Profile" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} subheader="Account information" subheaderTypographyProps={{ variant: 'caption' }} />
      <CardContent sx={{ ...cardContentSx, pt: 0 }}>
        <Stack spacing={0.5}>
          <InfoRow label="Username" value={user.username} mono />
          <InfoRow label="Display Name" value={user.displayName} />
          <InfoRow label="Role" value={<Chip label={user.role} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }} />} />
          <InfoRow label="User ID" value={user.id} mono />
        </Stack>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Security Tab
// =============================================================================

function SecuritySection() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (!oldPassword || !newPassword) { setError('All fields are required.'); return; }
    if (newPassword !== confirmPassword) { setError('New passwords do not match.'); return; }
    if (newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }

    setSubmitting(true);
    try {
      await auth.changePassword({ oldPassword, newPassword });
      setSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err?.message ?? 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ ...cardSx, maxWidth: 480 }}>
      <CardHeader title="Change Password" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} subheader="Update your account credentials" subheaderTypographyProps={{ variant: 'caption' }} />
      <CardContent sx={{ ...cardContentSx, pt: 0 }}>
        {success && <Alert severity="success" variant="outlined" sx={{ mb: 2 }} onClose={() => setSuccess(false)}>Password changed successfully.</Alert>}
        {error && <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
        <form onSubmit={handleSubmit} noValidate>
          <Stack spacing={2}>
            <TextField size="small" label="Current Password" type={showOld ? 'text' : 'password'} value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" fullWidth
              slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => setShowOld(!showOld)} edge="end">{<EyeIcon open={showOld} sx={{ fontSize: 18 }} />}</IconButton></InputAdornment> } }} />
            <TextField size="small" label="New Password" type={showNew ? 'text' : 'password'} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" fullWidth
              slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton size="small" onClick={() => setShowNew(!showNew)} edge="end">{<EyeIcon open={showNew} sx={{ fontSize: 18 }} />}</IconButton></InputAdornment> } }} />
            <TextField size="small" label="Confirm New Password" type={showNew ? 'text' : 'password'} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" fullWidth />
            <Button type="submit" variant="contained" size="small" disabled={submitting} startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : undefined} sx={{ alignSelf: 'flex-start' }}>
              {submitting ? 'Changing...' : 'Change Password'}
            </Button>
          </Stack>
        </form>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Sessions Tab
// =============================================================================

function SessionsSection() {
  const user = useAuthStore((s) => s.user);
  const currentSessionId = getSessionId();
  const [sessions, setSessions] = useState<OmnitronActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    if (!user) return;
    try {
      const list = await auth.getActiveSessions();
      setSessions(Array.isArray(list) ? list : []);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, [user, currentSessionId]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleRevoke = async (sessionId: string) => {
    setRevoking(sessionId);
    try {
      await auth.signOut({ sessionId });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err: any) {
      setError(`Failed to revoke: ${err?.message ?? 'Unknown error'}`);
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    for (const session of sessions.filter((s) => !s.current)) {
      try { await auth.signOut({ sessionId: session.id }); } catch { /* continue */ }
    }
    await fetchSessions();
  };

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardHeader
        title="Active Sessions"
        titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }}
        subheader={loading ? 'Loading...' : `${sessions.length} active session${sessions.length !== 1 ? 's' : ''}`}
        subheaderTypographyProps={{ variant: 'caption' }}
        action={sessions.filter((s) => !s.current).length > 1 ? <Button size="small" color="error" variant="text" onClick={handleRevokeAll} sx={{ fontSize: '0.7rem' }}>Revoke All Others</Button> : undefined}
      />
      {error && <Alert severity="error" variant="outlined" sx={{ mx: 2, mb: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading ? (
        <CardContent sx={{ ...cardContentSx, pt: 0 }}>
          <Stack spacing={1}>{[...Array(2)].map((_, i) => <Skeleton key={i} height={48} />)}</Stack>
        </CardContent>
      ) : sessions.length === 0 ? (
        <CardContent sx={{ ...cardContentSx, pt: 0 }}>
          <Typography variant="body2" color="text.secondary">No active sessions found.</Typography>
        </CardContent>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Session</TableCell>
                <TableCell>IP Address</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Expires</TableCell>
                <TableCell align="center">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{session.id.slice(0, 8)}...</Typography>
                      {session.current && <Chip label="current" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: 10 }} />}
                    </Stack>
                  </TableCell>
                  <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{session.ipAddress ?? '--'}</Typography></TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{timeAgo(session.createdAt)}</Typography></TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{formatDateShort(session.expiresAt)}</Typography></TableCell>
                  <TableCell align="center">
                    {!session.current && (
                      <IconButton size="small" color="error" disabled={revoking === session.id} onClick={() => handleRevoke(session.id)} title="Revoke session">
                        {revoking === session.id ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon sx={{ fontSize: 18 }} />}
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  );
}

// =============================================================================
// Appearance Tab
// =============================================================================

function AppearanceSection() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>(() => (localStorage.getItem(LS_THEME_MODE) as 'light' | 'dark' | 'system') || 'dark');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readLocalBool(LS_SIDEBAR_COLLAPSED, false));
  const [compactDensity, setCompactDensity] = useState(() => readLocalBool(LS_COMPACT_DENSITY, false));

  return (
    <Card variant="outlined" sx={{ ...cardSx, maxWidth: 480 }}>
      <CardHeader title="Appearance" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} subheader="Customize the console interface" subheaderTypographyProps={{ variant: 'caption' }} />
      <CardContent sx={{ ...cardContentSx, pt: 0 }}>
        <Stack spacing={3}>
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Theme Mode</Typography>
            <ToggleButtonGroup value={themeMode} exclusive onChange={(_, v) => { if (v) { setThemeMode(v); localStorage.setItem(LS_THEME_MODE, v); } }} size="small" fullWidth>
              <ToggleButton value="light" sx={{ textTransform: 'none', fontSize: '0.8rem' }}>Light</ToggleButton>
              <ToggleButton value="dark" sx={{ textTransform: 'none', fontSize: '0.8rem' }}>Dark</ToggleButton>
              <ToggleButton value="system" sx={{ textTransform: 'none', fontSize: '0.8rem' }}>System</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Divider />
          <FormControlLabel
            control={<Switch size="small" checked={sidebarCollapsed} onChange={(_, c) => { setSidebarCollapsed(c); writeLocalBool(LS_SIDEBAR_COLLAPSED, c); }} />}
            label={<Box><Typography variant="body2" fontWeight={600}>Sidebar collapsed by default</Typography><Typography variant="caption" color="text.secondary">Start with the navigation sidebar minimized</Typography></Box>}
            sx={{ alignItems: 'flex-start', ml: 0 }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={compactDensity} onChange={(_, c) => { setCompactDensity(c); writeLocalBool(LS_COMPACT_DENSITY, c); }} />}
            label={<Box><Typography variant="body2" fontWeight={600}>Compact density</Typography><Typography variant="caption" color="text.secondary">Reduce spacing and padding throughout the UI</Typography></Box>}
            sx={{ alignItems: 'flex-start', ml: 0 }}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Notifications Tab
// =============================================================================

function NotificationsSection() {
  const [desktopNotifications, setDesktopNotifications] = useState(() => readLocalBool(LS_DESKTOP_NOTIFICATIONS, false));
  const [soundAlerts, setSoundAlerts] = useState(() => readLocalBool(LS_SOUND_ALERTS, true));
  const [alertSeverity, setAlertSeverity] = useState<string>(() => localStorage.getItem(LS_ALERT_SEVERITY) || 'error');
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');

  const handleDesktopToggle = async (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    if (checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      if (permission !== 'granted') { setDesktopNotifications(false); writeLocalBool(LS_DESKTOP_NOTIFICATIONS, false); return; }
    }
    setDesktopNotifications(checked);
    writeLocalBool(LS_DESKTOP_NOTIFICATIONS, checked);
  };

  return (
    <Card variant="outlined" sx={{ ...cardSx, maxWidth: 480 }}>
      <CardHeader title="Notifications" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 700 }} subheader="Configure alert delivery preferences" subheaderTypographyProps={{ variant: 'caption' }} />
      <CardContent sx={{ ...cardContentSx, pt: 0 }}>
        <Stack spacing={3}>
          <FormControlLabel
            control={<Switch size="small" checked={desktopNotifications} onChange={handleDesktopToggle} disabled={permissionState === 'denied'} />}
            label={<Box><Typography variant="body2" fontWeight={600}>Desktop notifications</Typography><Typography variant="caption" color="text.secondary">{permissionState === 'denied' ? 'Blocked by browser — enable in site settings' : permissionState === 'unsupported' ? 'Not supported' : 'Show browser notifications for alerts'}</Typography></Box>}
            sx={{ alignItems: 'flex-start', ml: 0 }}
          />
          <FormControlLabel
            control={<Switch size="small" checked={soundAlerts} onChange={(_, c) => { setSoundAlerts(c); writeLocalBool(LS_SOUND_ALERTS, c); }} />}
            label={<Box><Typography variant="body2" fontWeight={600}>Sound alerts</Typography><Typography variant="caption" color="text.secondary">Play audio cue on critical alerts</Typography></Box>}
            sx={{ alignItems: 'flex-start', ml: 0 }}
          />
          <Divider />
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Minimum alert severity</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>Only receive notifications at or above this level</Typography>
            <FormControl size="small" fullWidth>
              <Select value={alertSeverity} onChange={(e) => { setAlertSeverity(e.target.value); localStorage.setItem(LS_ALERT_SEVERITY, e.target.value); }}>
                <MenuItem value="info">Info</MenuItem>
                <MenuItem value="warn">Warning</MenuItem>
                <MenuItem value="error">Error</MenuItem>
                <MenuItem value="fatal">Fatal</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Settings Page — Tabbed Layout (portal pattern)
// =============================================================================

// =============================================================================
// Page
// =============================================================================

export default function SettingsPage() {
  return (
    <Tabs defaultValue="general" keepMounted>
      <TabPanel value="general" label="General">
        <GeneralSection />
      </TabPanel>
      <TabPanel value="security" label="Security">
        <SecuritySection />
      </TabPanel>
      <TabPanel value="sessions" label="Sessions">
        <SessionsSection />
      </TabPanel>
      <TabPanel value="notifications" label="Notifications">
        <NotificationsSection />
      </TabPanel>
    </Tabs>
  );
}
