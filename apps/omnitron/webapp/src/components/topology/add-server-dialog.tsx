/**
 * AddServerDialog — Dialog to add a new fleet server to the topology.
 */

import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { infra } from 'src/netron/client';
import { useTopologyStore } from './topology-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AddServerDialogProps {
  open: boolean;
  onClose: () => void;
}

const ROLES = [
  { value: 'app', label: 'Application Server' },
  { value: 'database', label: 'Database Server' },
  { value: 'cache', label: 'Cache Server' },
  { value: 'gateway', label: 'Gateway / Load Balancer' },
  { value: 'worker', label: 'Worker Node' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddServerDialog({ open, onClose }: AddServerDialogProps) {
  const fetchAll = useTopologyStore((s) => s.fetchAll);

  const [alias, setAlias] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [role, setRole] = useState('app');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setAlias('');
    setHost('');
    setPort('22');
    setRole('app');
    setTags('');
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (!submitting) {
      resetForm();
      onClose();
    }
  }, [submitting, resetForm, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!alias.trim() || !host.trim()) {
      setError('Alias and host are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await infra.addServer({
        alias: alias.trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      await fetchAll();
      resetForm();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to add server.');
    } finally {
      setSubmitting(false);
    }
  }, [alias, host, port, role, tags, fetchAll, resetForm, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: '#0c0c14',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#e2e8f0',
        },
      }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid rgba(255,255,255,0.06)', fontWeight: 700 }}>
        Add Server
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Register a new remote server to the fleet. The server must be reachable
          and have the Omnitron agent installed.
        </Typography>

        {error && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Stack spacing={2.5}>
          <TextField
            label="Alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="e.g., prod-db-01"
            required
            fullWidth
            size="small"
            slotProps={{
              inputLabel: { sx: { color: '#94a3b8' } },
              input: {
                sx: {
                  color: '#e2e8f0',
                  fontFamily: 'monospace',
                  '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                  '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                },
              },
            }}
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Host / IP"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="192.168.1.100"
              required
              fullWidth
              size="small"
              slotProps={{
                inputLabel: { sx: { color: '#94a3b8' } },
                input: {
                  sx: {
                    color: '#e2e8f0',
                    fontFamily: 'monospace',
                    '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                  },
                },
              }}
            />
            <TextField
              label="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              sx={{ width: 120 }}
              size="small"
              slotProps={{
                inputLabel: { sx: { color: '#94a3b8' } },
                input: {
                  sx: {
                    color: '#e2e8f0',
                    fontFamily: 'monospace',
                    '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                    '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                  },
                },
              }}
            />
          </Stack>

          <TextField
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            select
            fullWidth
            size="small"
            slotProps={{
              inputLabel: { sx: { color: '#94a3b8' } },
              input: {
                sx: {
                  color: '#e2e8f0',
                  '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                  '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                },
              },
            }}
          >
            {ROLES.map((r) => (
              <MenuItem key={r.value} value={r.value}>
                {r.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="gpu, ssd, high-mem (comma-separated)"
            fullWidth
            size="small"
            slotProps={{
              inputLabel: { sx: { color: '#94a3b8' } },
              input: {
                sx: {
                  color: '#e2e8f0',
                  '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                  '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.2)' },
                },
              },
            }}
          />
        </Stack>
      </DialogContent>

      <DialogActions sx={{ borderTop: '1px solid rgba(255,255,255,0.06)', px: 3, py: 2 }}>
        <Button onClick={handleClose} disabled={submitting} sx={{ color: '#94a3b8', textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || !alias.trim() || !host.trim()}
          startIcon={submitting ? <CircularProgress size={16} /> : undefined}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Add Server
        </Button>
      </DialogActions>
    </Dialog>
  );
}
