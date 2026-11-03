import { Box, Button, Chip, Stack } from '@mui/material';
import { Can } from 'src/auth/access';
import { DeployIcon } from 'src/assets/icons';
import { ReleaseDeploymentState } from './release-deployment-state';

/** Stack details use the same observation/history model as Releases. */
export function StackReleaseCard({ project, stack, requiresRelease, managed, selected, onDeploy, onWorkingTree }: {
  project: string; stack: string; requiresRelease: boolean; managed: boolean; selected?: string | undefined; onDeploy: () => void; onWorkingTree?: (() => void) | undefined;
}) {
  return <Box sx={{ mb: 2, minWidth: 0 }}>
    {!managed && <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
      {selected && <Chip label={'Selected: ' + selected} size="small" variant="outlined" />}
      {requiresRelease && <Chip label="Release required" size="small" variant="outlined" />}
      <Box sx={{ flex: 1 }} />
      {onWorkingTree && <Can permission="OmnitronProject.startStack"><Button size="small" onClick={onWorkingTree}>Use working tree…</Button></Can>}
      <Can permission="OmnitronProject.startStack"><Button size="small" startIcon={<DeployIcon />} onClick={onDeploy}>Deploy release…</Button></Can>
    </Stack>}
    <ReleaseDeploymentState key={`${project}/${stack}`} project={project} stack={stack} />
  </Box>;
}
