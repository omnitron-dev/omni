import { Box, Button, Chip, Stack } from '@mui/material';
import { Can } from 'src/auth/access';
import { DeployIcon } from 'src/assets/icons';
import { ReleaseDeploymentState } from './release-deployment-state';

/** Stack details use the same observation/history model as Releases. */
export function StackReleaseCard({ project, stack, requiresRelease, local, onDeploy }: {
  project: string; stack: string; requiresRelease: boolean; local: boolean; onDeploy: () => void;
}) {
  return <Box sx={{ mb: 2, minWidth: 0 }}>
    {!local && <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
      {requiresRelease && <Chip label="Release required" size="small" variant="outlined" />}
      <Box sx={{ flex: 1 }} />
      <Can permission="OmnitronProject.startStack"><Button size="small" startIcon={<DeployIcon />} onClick={onDeploy}>Deploy release…</Button></Can>
    </Stack>}
    <ReleaseDeploymentState key={`${project}/${stack}`} project={project} stack={stack} />
  </Box>;
}
