import { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { IProjectInfo, ConfigurationImport } from '@omnitron-dev/omnitron/dto/services';

export function ImportStacksDialog({ project, onClose, onImport }: {
  project: IProjectInfo;
  onClose: () => void;
  onImport: (input: ConfigurationImport) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [registration, setRegistration] = useState('');
  const [mapping, setMapping] = useState('local=test');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const stacks: Record<string, string> = Object.create(null);
      for (const line of mapping.trim().split(/\n+/)) {
        const pair = line.split('=').map(value => value.trim());
        if (pair.length !== 2 || !pair[0] || !pair[1] || Object.hasOwn(stacks, pair[0]))
          throw new Error('Use one unique source=project stack mapping per line.');
        stacks[pair[0]] = pair[1];
      }
      await onImport({ project: project.name, name: name.trim(), path: path.trim(),
        ...(registration.trim() ? { registration: registration.trim() } : {}),
        stacks, expectedRevision: project.catalogRevision ?? '' });
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Import stacks into {project.displayName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Add stacks from a configuration in this repository. Running applications and their history stay in place.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField autoFocus label="Configuration name" value={name} onChange={event => setName(event.target.value)} disabled={busy} required />
          <TextField label="Configuration directory" value={path} onChange={event => setPath(event.target.value)} disabled={busy} required helperText={`Inside ${project.path}`} />
          <TextField label="Stack mapping" multiline minRows={2} value={mapping} onChange={event => setMapping(event.target.value)} disabled={busy} helperText="Each line: source stack = stack name in this project. Map every source stack." />
          <TextField label="Existing registration (optional)" value={registration} onChange={event => setRegistration(event.target.value)} disabled={busy} helperText="To consolidate an existing registration, enter its exact name." />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !name.trim() || !path.trim() || !mapping.trim() || !project.catalogRevision}>Import stacks</Button>
      </DialogActions>
    </Dialog>
  );
}
