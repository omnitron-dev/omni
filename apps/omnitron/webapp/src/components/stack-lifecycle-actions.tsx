import { Button, CircularProgress } from '@mui/material';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';
import { DeployIcon, PlayIcon, StopIcon } from 'src/assets/icons';
import { Can } from 'src/auth/access';
import type { PendingOp } from 'src/stores/project.store';
import { hasInstalledRecovery, StackRecoveryAction } from './stack-recovery';

/** The inventory and the stack details offer the same next step for the same observation. */
export function StackLifecycleActions({ stack, pending, onStart, onDeploy, onResume, onReviewStop, detailed = false }: {
  stack: IStackInfo;
  pending: PendingOp | null;
  onStart: () => void;
  onDeploy: () => void;
  onResume: () => void;
  onReviewStop: () => void;
  detailed?: boolean;
}) {
  const transition = pending ?? (stack.status === 'starting' || stack.status === 'stopping' ? stack.status : null);
  if (transition) return <Button size="small" disabled startIcon={<CircularProgress size={14} />}>
    {transition === 'resuming' ? 'Resuming installed apps…' : transition === 'starting' ? 'Starting…' : 'Stopping…'}
  </Button>;

  if (hasInstalledRecovery(stack)) return <StackRecoveryAction stack={stack} onResume={onResume} onReviewStop={onReviewStop} />;

  if (stack.status === 'stopped') {
    const needsRelease = stack.config?.release?.mode === 'required' && !stack.selectedRelease;
    return <Can permission="OmnitronProject.startStack">
      <Button size="small" variant={detailed ? 'contained' : 'text'} color="success"
        startIcon={needsRelease ? <DeployIcon /> : <PlayIcon />} onClick={needsRelease ? onDeploy : onStart}>
        {needsRelease ? 'Deploy release…' : 'Start'}
      </Button>
    </Can>;
  }

  return <>
    {!detailed && stack.type !== 'local' && stack.status === 'running' && <Can permission="OmnitronProject.startStack">
      <Button size="small" startIcon={<DeployIcon />} onClick={onDeploy}>Deploy…</Button>
    </Can>}
    <Can permission="OmnitronProject.reviewStackStop">
      <Button size="small" variant={detailed ? 'outlined' : 'text'} startIcon={<StopIcon />} color="error" onClick={onReviewStop}>
        {stack.stopOperation?.phase === 'failed' && !stack.stopOperation.supersededAt ? 'Review retry…' : 'Review stop…'}
      </Button>
    </Can>
  </>;
}
