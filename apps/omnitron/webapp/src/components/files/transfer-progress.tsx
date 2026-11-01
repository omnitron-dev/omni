import { LinearProgress, Typography } from '@mui/material';
import type { FileTransfer } from '@omnitron-dev/omnitron/dto/services';
import { fileBytes } from './model';

export function fileTransferProgress(job: FileTransfer) {
  const phase = job.phase ?? (job.state === 'planning' ? 'planning' : 'transferring');
  const label =
    {
      planning: 'Planning',
      snapshotting: 'Capturing source snapshot',
      archiving: 'Creating archive',
      transferring: 'Transferring bytes',
      restoring: 'Restoring destination folder',
      publishing: 'Verifying and publishing',
    }[phase] ?? 'Processing transfer';
  const active = job.state === 'planning' || job.state === 'running';
  const snapshot = phase === 'snapshotting',
    restoring = phase === 'restoring';
  const current = snapshot ? (job.preparedBytes ?? 0) : restoring ? (job.restoredBytes ?? 0) : job.bytes;
  const total = snapshot || restoring ? (job.sourceBytes ?? 0) : job.totalBytes;
  const measured =
    (snapshot || (restoring && job.restoredBytes !== undefined) || phase === 'transferring') && total > 0;
  return {
    label,
    indeterminate: active && !measured,
    value: job.state === 'completed' ? 100 : measured ? Math.min(100, (current / total) * 100) : 0,
    detail: snapshot
      ? total > 0
        ? `Snapshot ${fileBytes(current)} / ${fileBytes(total)}`
        : `${fileBytes(current)} captured`
      : restoring && job.restoredBytes !== undefined
        ? `${fileBytes(current)} / ${fileBytes(total)} restored`
        : job.archive && !job.totalBytes && job.state !== 'completed'
          ? 'Transfer size is available after the archive is prepared'
          : `${fileBytes(job.bytes)} / ${fileBytes(job.totalBytes)} transferred · ${job.completedFiles} / ${job.totalFiles} files`,
  };
}

export function FileTransferProgress({ job }: { job: FileTransfer }) {
  const progress = fileTransferProgress(job);
  return (
    <>
      {job.archive && (
        <Typography variant="caption" component="div" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {job.archive.format} · {job.archive.output === 'directory' ? 'Restore folder' : 'Archive file'} ·{' '}
          {job.archive.name}
        </Typography>
      )}
      <LinearProgress
        sx={{ my: 1 }}
        aria-label={job.state === 'completed' ? 'Completed transfer' : progress.label}
        variant={progress.indeterminate ? 'indeterminate' : 'determinate'}
        value={progress.value}
      />
      {job.publication === 'partial' && job.state !== 'completed' && (
        <Typography variant="caption" component="div" color="warning.main">
          {job.state === 'running'
            ? 'Destination folder is being published; it is not ready yet.'
            : 'Destination folder publication is incomplete. Resume this transfer to finish before using the folder.'}
        </Typography>
      )}
      <Typography variant="caption" component="div">
        {job.state === 'completed' ? 'Completed' : progress.label} · {progress.detail}
      </Typography>
    </>
  );
}
