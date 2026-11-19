import { Box, Button, Stack, Typography } from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { isBuiltinStudioProvider, type StudioProvider } from '@omnitron-dev/omnitron/dto/services';
import { quoteShellArgument } from 'src/utils/shell-command';
import { studioProviderName } from 'src/utils/studio-provider';

interface Props {
  project: string | null;
  account: string;
  provider: StudioProvider;
  connected?: boolean;
  onCopy?: (command: string) => void;
}

export function StudioConnectorDetails({ project, account, provider, connected, onCopy }: Props) {
  const name = studioProviderName(provider);
  if (!isBuiltinStudioProvider(provider)) {
    return (
      <Alert severity="info" sx={{ overflowWrap: 'anywhere' }}>
        {connected
          ? `${name} is connected for ${account} on this controller.`
          : `Start the ${name} connector on this controller for ${account} to choose a model.`}
      </Alert>
    );
  }
  const scope = project ? quoteShellArgument(project) : '--planning';
  const command = `omnitron studio connect ${scope} --account ${quoteShellArgument(account)} --provider ${provider}`;
  return (
    <Alert severity="info">
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography variant="body2">Connect {name} from a terminal on this controller.</Typography>
        <Box component="code" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.8125rem' }}>
          {command}
        </Box>
        {onCopy && (
          <Button size="small" sx={{ alignSelf: 'start' }} onClick={() => onCopy(command)}>
            Copy command
          </Button>
        )}
      </Stack>
    </Alert>
  );
}
