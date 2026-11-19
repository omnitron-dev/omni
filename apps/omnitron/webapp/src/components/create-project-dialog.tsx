import { useState } from 'react';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { defaultProjectStarterNeeds, isProjectStarterNeeds, projectStarterOptions, type ProjectStarterNeeds } from '@omnitron-dev/omnitron/dto/services';
import { project } from 'src/netron/client';

type Review = Awaited<ReturnType<typeof project.reviewProjectCreation>>;

function suggestedNeeds(query: URLSearchParams) {
  const automation = query.get('automation');
  const input = { automation: automation === null || automation === '0' ? false : automation === '1' ? true : automation,
    persistence: query.get('persistence') ?? defaultProjectStarterNeeds.persistence,
    service: query.get('service') ?? defaultProjectStarterNeeds.service };
  return isProjectStarterNeeds(input) ? { needs: input, error: '' }
    : { needs: defaultProjectStarterNeeds, error: 'The suggested choices are invalid. Select the project features to review.' };
}

export function CreateProjectDialog({ query, onClose, onCreated }: { query: URLSearchParams; onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState(() => query.get('name') ?? '');
  const [suggestion] = useState(() => suggestedNeeds(query));
  const [needs, setNeeds] = useState<ProjectStarterNeeds>(suggestion.needs);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(suggestion.error);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (review) {
        const result = await project.createProject({ name: review.name, needs: review.manifest.needs, digest: review.digest });
        onCreated(result.name);
      } else setReview(await project.reviewProjectCreation({ name: name.trim(), needs }));
    } catch (reason) {
      setReview(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const changeNeeds = (patch: Partial<ProjectStarterNeeds>) => {
    setNeeds({ ...needs, ...patch }); setReview(null); setError('');
  };
  return <Dialog open fullWidth maxWidth="sm" aria-labelledby="create-project-title" onClose={busy ? undefined : onClose}>
    <DialogTitle id="create-project-title">Create project</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <TextField label="Project name" value={name} autoFocus disabled={busy}
        helperText="Lowercase letters, digits and hyphens. Begin with a letter."
        onChange={event => { setName(event.target.value); setReview(null); setError(''); }} />
      <FormControlLabel label="Run automation with Xec" control={<Checkbox checked={needs.automation} disabled={busy}
        onChange={event => changeNeeds({ automation: event.target.checked })} />} />
      <TextField select label="Where should the project store data?" value={needs.persistence} disabled={busy}
        helperText="Database choices include a Kysera program and its database driver."
        onChange={event => changeNeeds({ persistence: event.target.value as ProjectStarterNeeds['persistence'] })}>
        {Object.entries(projectStarterOptions.persistence).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>
      <TextField select label="Which service should Omnitron supervise?" value={needs.service} disabled={busy}
        onChange={event => changeNeeds({ service: event.target.value as ProjectStarterNeeds['service'] })}>
        {Object.entries(projectStarterOptions.service).map(([value,label])=><MenuItem key={value} value={value}>{label}</MenuItem>)}
      </TextField>
      {review && <>
        <Typography variant="body2"><strong>{review.path}</strong></Typography>
        <Box component="ul" sx={{ my: 0 }}>{review.effects.map(effect => <li key={effect}>{effect}</li>)}</Box>
        <Typography variant="body2">Runtime dependencies · {Object.entries(review.manifest.dependencies)
          .map(([dependency, version]) => dependency + '@' + version).join(', ') || 'Node standard library'}</Typography>
        <Typography variant="body2">Commands · {Object.keys(review.manifest.commands).map(command => 'npm run ' + command).join(', ')}</Typography>
        {review.files.map(file => <details key={file.path}>
          <summary>{file.path}</summary>
          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{file.content}</Box>
        </details>)}
      </>}
      {error && <Alert severity="error">{error}</Alert>}
    </Stack></DialogContent>
    <DialogActions>
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button variant="contained" onClick={() => void submit()} disabled={busy || !name.trim() || !isProjectStarterNeeds(needs)} loading={busy}>
        {review ? 'Create project' : 'Review starter'}
      </Button>
    </DialogActions>
  </Dialog>;
}
