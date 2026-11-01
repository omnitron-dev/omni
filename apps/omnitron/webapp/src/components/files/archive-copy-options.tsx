import { useEffect, useRef, useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type {
  FileArchiveCapabilities,
  FileArchiveFormat,
  FileArchiveOptions,
} from '@omnitron-dev/omnitron/dto/services';
import { FILE_ARCHIVE_FORMATS, fileNameError } from '@omnitron-dev/omnitron/dto/services';
import { files } from 'src/netron/client';
import { OperationStatus } from '../operation-status';

export interface ArchiveCopyChoice {
  archive: FileArchiveOptions | undefined;
  ready: boolean;
}

/** Compression is an explicit operation with capabilities observed on the selected pair of nodes. */
export function ArchiveCopyOptions({
  sourceNodeId,
  destinationNodeId,
  directoryName,
  disabled = false,
  onChange,
}: {
  sourceNodeId: string;
  destinationNodeId: string;
  directoryName: string;
  disabled?: boolean;
  onChange: (choice: ArchiveCopyChoice) => void;
}) {
  const [mode, setMode] = useState<'files' | 'archive' | 'directory'>('files');
  const [observation, setObservation] = useState<{ nodes: string; value: FileArchiveCapabilities } | null>(null);
  const nodePair = JSON.stringify([sourceNodeId, destinationNodeId]);
  const capabilities = observation?.nodes === nodePair ? observation.value : null;
  const [loading, setLoading] = useState(false),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const [format, setFormat] = useState<FileArchiveFormat | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const enabled = mode !== 'files';
  const formats =
    capabilities?.formats.filter((item) => item.outputs.includes(mode === 'directory' ? 'directory' : 'archive')) ?? [];
  const selected = formats.find((item) => item.format === format) ?? formats[0];
  const name = customName ?? `${directoryName}${mode === 'archive' ? (selected?.extension ?? '') : ''}`;
  const nameError =
    fileNameError(name) ??
    (mode === 'archive' && selected && !name.toLocaleLowerCase().endsWith(selected.extension.toLocaleLowerCase())
      ? `Use a filename ending in ${selected.extension}`
      : null);
  const ready = mode === 'files' || Boolean(!loading && !failed && selected && !nameError);
  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    setObservation(null);
    setLoading(true);
    setFailed(false);
    void files
      .archiveFormats({ nodeId: sourceNodeId, destinationNodeId })
      .then((answer) => {
        if (!current) return;
        if (
          !answer ||
          !Array.isArray(answer.formats) ||
          answer.formats.some(
            (item) =>
              !item ||
              !FILE_ARCHIVE_FORMATS.includes(item.format) ||
              typeof item.label !== 'string' ||
              !Array.isArray(item.outputs) ||
              item.outputs.some((output) => !['archive', 'directory'].includes(output)) ||
              typeof item.extension !== 'string' ||
              !/^\.[a-z0-9.]+$/i.test(item.extension)
          ) ||
          !Array.isArray(answer.limitations) ||
          answer.limitations.some((item) => typeof item !== 'string') ||
          !Number.isFinite(Date.parse(answer.observedAt))
        )
          throw new Error('Incompatible archive capabilities');
        setObservation({ nodes: nodePair, value: answer });
      })
      .catch(() => {
        if (current) setFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [enabled, sourceNodeId, destinationNodeId, nodePair, retry]);
  useEffect(() => {
    callback.current({
      archive: mode !== 'files' && selected && ready ? { format: selected.format, name, output: mode } : undefined,
      ready,
    });
  }, [mode, selected, name, ready]);
  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        disabled={disabled}
        aria-label="Copy mode"
        onChange={(_, value: typeof mode | null) => {
          if (value) {
            if (value === 'files') setObservation(null);
            setMode(value);
            setCustomName(null);
          }
        }}
        sx={{ flexWrap: 'wrap', '& .MuiToggleButton-root': { flex: '1 1 auto', whiteSpace: 'nowrap' } }}
      >
        <ToggleButton value="files" aria-label="Copy files individually">
          Files
        </ToggleButton>
        <ToggleButton value="archive" aria-label="Save archive file">
          Archive
        </ToggleButton>
        <ToggleButton value="directory" aria-label="Transfer archive and restore folder">
          Pack &amp; restore
        </ToggleButton>
      </ToggleButtonGroup>
      {enabled && (
        <>
          <OperationStatus
            active={loading}
            label="Checking archive formats on the selected nodes…"
            detail="Only verified encoders and compatible destination decoders are offered."
          />
          {failed && (
            <Alert
              severity="warning"
              action={
                <Button size="small" disabled={disabled || loading} onClick={() => setRetry((value) => value + 1)}>
                  Retry
                </Button>
              }
            >
              Archive capabilities are unavailable. Check node connectivity and backend support; ordinary file copy is
              still available.
            </Alert>
          )}
          {capabilities && !formats.length && (
            <Alert severity="info">
              {mode === 'directory'
                ? 'No archive format is supported by both the source encoder and destination decoder.'
                : 'No supported archive encoders were found on the source node.'}
            </Alert>
          )}
          {formats.length > 0 && (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  select
                  size="small"
                  label="Archive format"
                  value={selected?.format ?? ''}
                  disabled={disabled || loading}
                  sx={{ minWidth: 150, flex: 1 }}
                  onChange={(event) => {
                    const next = formats.find((item) => item.format === event.target.value);
                    if (!next) return;
                    setFormat(next.format);
                    if (
                      mode === 'archive' &&
                      customName &&
                      selected &&
                      customName.toLocaleLowerCase().endsWith(selected.extension.toLocaleLowerCase())
                    )
                      setCustomName(customName.slice(0, -selected.extension.length) + next.extension);
                  }}
                >
                  {formats.map((item) => (
                    <MenuItem key={item.format} value={item.format}>
                      {item.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label={mode === 'archive' ? 'Archive filename' : 'Destination folder name'}
                  value={name}
                  disabled={disabled || loading}
                  onChange={(event) => setCustomName(event.target.value)}
                  error={Boolean(nameError)}
                  helperText={nameError ?? 'One new entry in the destination folder'}
                  sx={{ flex: 2, minWidth: 0 }}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {mode === 'archive'
                  ? 'The destination receives an archive file; it is not extracted.'
                  : 'The source is packed, transferred and restored into a new destination folder after verification.'}
              </Typography>
            </>
          )}
          {capabilities && (
            <Typography variant="caption" color="text.secondary">
              Capabilities checked {new Date(capabilities.observedAt).toLocaleString()}
            </Typography>
          )}
          {capabilities?.limitations.length ? (
            <Typography component="details" variant="caption" color="text.secondary">
              <summary>Limits and guarantees</summary>
              {capabilities.limitations.map((item) => (
                <Typography key={item} component="div" variant="caption">
                  {item}
                </Typography>
              ))}
            </Typography>
          ) : null}
        </>
      )}
    </Stack>
  );
}
