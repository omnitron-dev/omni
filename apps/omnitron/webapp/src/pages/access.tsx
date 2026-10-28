import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Breadcrumbs } from '@omnitron-dev/prism/components/breadcrumbs';
import type { ConsoleAccount, ConsoleRole } from '@omnitron-dev/omnitron/dto/services';
import { consolePasswordError } from '@omnitron-dev/omnitron/dto/services';
import { access } from 'src/netron/client';
import { useAccess } from 'src/auth/access';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { secureTerminalOrigin } from 'src/utils/terminal-input';

export default function AccessPage() {
  const { snapshot, can } = useAccess();
  const [after, setAfter] = useState<string | undefined>();
  const {
    data: page,
    error: listError,
    refresh,
  } = usePolledResource(async () => ({ cursor: after, result: await access.listUsers(after ? { after } : {}) }), {
    intervalMs: 15_000,
    enabled: can('OmnitronAccess.listUsers'),
  });
  const data = page?.cursor === after ? page?.result : null;
  const mayListUsers = can('OmnitronAccess.listUsers');
  useEffect(() => {
    // If navigation raced a poll, its old response must trigger the current
    // page fetch once the runner is free, without displaying the old page.
    if (mayListUsers && page?.cursor !== after) void refresh();
  }, [after, refresh, mayListUsers, page]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<ConsoleRole>('viewer');
  const [editing, setEditing] = useState<ConsoleAccount | null>(null);
  const [revoking, setRevoking] = useState<ConsoleAccount | null>(null);
  const secure = secureTerminalOrigin(window.location);
  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const closeCreate = () => {
    setCreating(false);
    setPassword('');
    setUsername('');
    setDisplayName('');
    setRole('viewer');
  };
  const visible =
    snapshot?.capabilities.filter((c) => `${c.service}.${c.method}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return (
    <Box>
      <Breadcrumbs heading="Access" links={[{ name: 'System' }, { name: 'Access' }]} />
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Your role: <strong>{snapshot?.role}</strong>. Permissions below come from this daemon’s active RPC policy.
      </Typography>
      {(error || listError) && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error || listError}
        </Alert>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        {snapshot?.roles.map((r) => (
          <Card key={r.role} sx={{ p: 2 }}>
            <Typography variant="h6">{r.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {r.description}
            </Typography>
          </Card>
        ))}
      </Box>
      {can('OmnitronAccess.listUsers') && (
        <Card sx={{ p: 2, mb: 3 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              Console accounts
            </Typography>
            <Button onClick={() => void refresh()}>Refresh</Button>
            <Button
              variant="contained"
              disabled={!secure || !can('OmnitronAccess.createUser')}
              onClick={() => setCreating(true)}
            >
              Create account
            </Button>
          </Stack>
          {!secure && (
            <Alert severity="warning">Use HTTPS to create accounts. Local loopback development is allowed.</Alert>
          )}
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell>Last sign-in</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data?.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      {u.displayName || u.username}
                      {(u.displayName || u.id === snapshot?.userId) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {u.displayName ? u.username : ''}
                          {u.id === snapshot?.userId ? (u.displayName ? ' · you' : 'you') : ''}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={u.role} />
                    </TableCell>
                    <TableCell>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        disabled={busy || u.id === snapshot?.userId || !can('OmnitronAccess.setRole')}
                        onClick={() => {
                          setRole(u.role === 'admin' || u.role === 'operator' ? u.role : 'viewer');
                          setEditing(u);
                        }}
                      >
                        Change role
                      </Button>
                      <Button
                        size="small"
                        color="warning"
                        disabled={busy || !can('OmnitronAccess.revokeSessions')}
                        onClick={() => setRevoking(u)}
                      >
                        Revoke sessions
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button disabled={!after} onClick={() => setAfter(undefined)}>
              First page
            </Button>
            <Button disabled={!data?.next} onClick={() => setAfter(data?.next ?? undefined)}>
              Next page
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Role changes revoke that account’s sessions. The last administrator is protected. Local CLI access follows
            the owner-only Unix socket policy.
          </Typography>
        </Card>
      )}
      <Card sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            Effective permissions
          </Typography>
          <TextField
            size="small"
            label="Filter service or method"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Stack>
        <Box sx={{ maxHeight: 560, overflow: 'auto' }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                <TableCell>Service / method</TableCell>
                <TableCell>Declared roles</TableCell>
                <TableCell>Your access</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((c) => (
                <TableRow key={`${c.service}.${c.method}`}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {c.service}.{c.method}
                  </TableCell>
                  <TableCell>{c.roles.join(', ') || (c.anonymous ? 'Anonymous' : 'Authenticated')}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={c.allowed ? 'success' : 'default'}
                      label={c.conditional ? 'Conditional' : c.allowed ? 'Allowed' : 'Denied'}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Resource ownership, session validity and other contextual checks still apply when an action runs. Application
          roles are managed by the application.
        </Typography>
      </Card>
      <Dialog
        open={creating && can('OmnitronAccess.createUser')}
        onClose={() => !busy && closeCreate()}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Create console account</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
            <TextField label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <TextField
              label="Initial password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText="At least 15 characters; share through a secure channel. The user can change it in Settings."
            />
            <RoleSelect value={role} onChange={setRole} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={closeCreate}>
            Cancel
          </Button>
          <Button
            disabled={busy || !secure || !username || !!consolePasswordError(password)}
            onClick={() =>
              void act(async () => {
                await access.createUser({ username, displayName, password, role });
                closeCreate();
              })
            }
          >
            Create account
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={editing !== null && can('OmnitronAccess.setRole')}
        onClose={() => !busy && setEditing(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Change role for {editing?.username}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          <Alert severity="warning" sx={{ mb: 2 }}>
            All sessions for this account will be revoked, including SSH terminals. The account must sign in again.
          </Alert>
          <RoleSelect value={role} onChange={setRole} />
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !editing || role === editing.role}
            onClick={() =>
              void act(async () => {
                if (editing) await access.setRole({ id: editing.id, role, previous: editing.role });
                setEditing(null);
              })
            }
          >
            Apply role
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={revoking !== null && can('OmnitronAccess.revokeSessions')}
        onClose={() => !busy && setRevoking(null)}
      >
        <DialogTitle>Revoke sessions for {revoking?.username}?</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}Existing sessions and SSH terminals will close. The account
          may sign in again with its password.
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setRevoking(null)}>
            Cancel
          </Button>
          <Button
            color="warning"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                if (revoking) await access.revokeSessions({ id: revoking.id });
                setRevoking(null);
              })
            }
          >
            Revoke sessions
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function RoleSelect({ value, onChange }: { value: ConsoleRole; onChange: (role: ConsoleRole) => void }) {
  const { snapshot } = useAccess();
  return (
    <TextField select fullWidth label="Role" value={value} onChange={(e) => onChange(e.target.value as ConsoleRole)}>
      {snapshot?.roles.map((r) => (
        <MenuItem key={r.role} value={r.role}>
          {r.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
