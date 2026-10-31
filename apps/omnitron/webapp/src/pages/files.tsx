import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { ConfirmDialog } from '@omnitron-dev/prism/components/confirm-dialog';
import { CloseIcon } from '@omnitron-dev/prism/icons';
import type { FileDocument, FileEntry, FileLocation, FileTrash } from '@omnitron-dev/omnitron/dto/services';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { FilePane, type FileAction } from 'src/components/files/file-pane';
import {
  describeFileError,
  encodeChunk,
  fileBytes,
  fileName,
  joinPath,
  lineEnding,
  relocateBuffer,
  type FileHost,
  type PaneSelection,
} from 'src/components/files/model';
import { files, nodes } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
const CodeEditor = lazy(() => import('src/components/files/code-editor'));
type BufferState = {
  id: string;
  location: FileLocation;
  document: FileDocument;
  text: string;
  readOnly: boolean;
  revision: number;
};
type Pending = {
  action: FileAction | 'saveCopy';
  pane: PaneSelection;
  destination?: PaneSelection;
  buffer?: BufferState;
};

/** Location panes and text buffers stay mounted while navigating between Console pages. */
export default function FilesPage({ visible = true }: { visible?: boolean }) {
  const theme = useTheme(),
    compact = useMediaQuery(theme.breakpoints.down('md'));
  const [hosts, setHosts] = useState<FileHost[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [active, setActive] = useState<'left' | 'right'>('left'),
    [split, setSplit] = useState(50),
    [refreshKey, setRefreshKey] = useState(0);
  const [panes, setPanes] = useState<Record<'left' | 'right', PaneSelection | null>>({ left: null, right: null });
  const [pending, setPending] = useState<Pending | null>(null),
    [name, setName] = useState('');
  const [buffers, setBuffers] = useState<BufferState[]>([]),
    [editorId, setEditorId] = useState(''),
    [editorOpen, setEditorOpen] = useState(false),
    [discard, setDiscard] = useState<string | null>(null);
  const [reloadBuffer, setReloadBuffer] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false),
    [trash, setTrash] = useState<{ pane: PaneSelection; items: FileTrash[] } | null>(null);
  const [browserTransfer, setBrowserTransfer] = useState<{
    label: string;
    bytes: number;
    total: number;
    committing: boolean;
  } | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null),
    uploadTarget = useRef<PaneSelection | null>(null),
    cancelled = useRef(false),
    workspace = useRef<HTMLDivElement>(null);
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;
  const jobs = usePolledResource(() => files.transfers(), { intervalMs: 2000, enabled: visible });
  const running = (jobs.data ?? []).filter((j) => ['running', 'planning'].includes(j.state));
  const unfinished = (jobs.data ?? []).filter((j) => !['completed', 'cancelled'].includes(j.state));
  const selected = panes[active],
    other = panes[active === 'left' ? 'right' : 'left'];
  const buffer = buffers.find((b) => b.id === editorId);
  const completed = (jobs.data ?? [])
    .filter((j) => j.state === 'completed')
    .map((j) => j.id)
    .join(',');
  const mounted = useRef(true),
    acting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void nodes
      .listNodes()
      .then((list) => {
        if (mounted.current)
          setHosts([
            { id: 'local', name: 'Local', host: 'daemon', isLocal: true },
            ...list.filter((n) => !n.isLocal).map((n) => ({ id: n.id, name: n.name, host: n.host, isLocal: false })),
          ]);
      })
      .catch((e) => setError(describeFileError(e)));
    return () => {
      mounted.current = false;
      cancelled.current = true;
    };
  }, []);
  useEffect(() => {
    setRefreshKey((k) => k + 1);
  }, [completed]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (buffersRef.current.some((b) => b.text !== b.document.content) || browserTransfer) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [browserTransfer]);
  const act = async (run: () => Promise<void>) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(describeFileError(e));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  const refresh = () => setRefreshKey((k) => k + 1);
  const focusPane = (side: 'left' | 'right') => {
    setActive(side);
    requestAnimationFrame(() => {
      const region = workspace.current?.querySelector<HTMLElement>(`[data-file-side="${side}"]`);
      (
        region?.querySelector<HTMLElement>('tr[data-cursor="true"]') ??
        region?.querySelector<HTMLElement>('[data-keyboard-focus]')
      )?.focus({ preventScroll: true });
    });
  };
  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? id;
  const label = (location: FileLocation) => `${hostName(location.nodeId)} / ${location.rootId} / ${location.path}`;
  const open = async (_entry: FileEntry, location: FileLocation, readOnly: boolean) =>
    act(async () => {
      const id = JSON.stringify(location),
        existing = buffersRef.current.find((b) => b.id === id);
      if (!existing) {
        if (buffersRef.current.length >= 8)
          throw new Error('Close a document before opening another (8 buffers per workspace)');
        const document = await files.readText(location);
        setBuffers((all) => [...all, { id, location, document, text: document.content, readOnly, revision: 0 }]);
      }
      setEditorId(id);
      setEditorOpen(true);
    });
  const save = (current: BufferState) =>
    act(async () => {
      if (current.readOnly || lineEnding(current.text) === 'mixed') throw new Error('This buffer is read only');
      const document = await files.saveText({
        ...current.location,
        content: current.text,
        version: current.document.version,
        bom: current.document.bom,
      });
      setBuffers((all) => all.map((b) => (b.id === current.id ? { ...b, document } : b)));
      refresh();
    });
  const closeBuffer = (id: string, confirmed = false) => {
    const current = buffersRef.current.find((b) => b.id === id);
    if (!confirmed && current && current.text !== current.document.content) {
      setDiscard(id);
      return;
    }
    const remaining = buffersRef.current.filter((b) => b.id !== id);
    setBuffers(remaining);
    if (id === editorId) setEditorId(remaining[0]?.id ?? '');
    if (!remaining.length) setEditorOpen(false);
    setDiscard(null);
  };
  const action = (side: 'left' | 'right', key: FileAction) => {
    const pane = panes[side];
    if (!pane) return;
    const destination = panes[side === 'left' ? 'right' : 'left'];
    setActive(side);
    if (key === 'upload') {
      uploadTarget.current = pane;
      uploadInput.current?.click();
      return;
    }
    if (key === 'download') {
      void download(pane);
      return;
    }
    if (key === 'trashList') {
      void act(async () => setTrash({ pane, items: await files.trashList(pane.location) }));
      return;
    }
    setName(key === 'rename' ? (pane.entries[0]?.name ?? '') : '');
    setPending({ action: key, pane, ...(destination ? { destination } : {}) });
  };
  const confirm = () =>
    act(async () => {
      if (!pending) return;
      const { pane } = pending;
      if (pending.action === 'copy') {
        if (!pending.destination || pending.destination.root.readOnly)
          throw new Error('Select a writable destination in the other panel');
        await files.copy({
          sources: pane.entries.map((e) => ({ ...pane.location, path: e.path, version: e.version })),
          destination: pending.destination.location,
        });
        setQueueOpen(true);
        await jobs.refresh();
      } else if (pending.action === 'trash') {
        for (const entry of pane.entries)
          await files.trash({ ...pane.location, path: entry.path, version: entry.version });
      } else {
        const path = joinPath(pane.location.path, fileName(name));
        if (pending.action === 'mkdir') await files.mkdir({ ...pane.location, path });
        if (pending.action === 'rename') {
          const entry = pane.entries[0]!;
          const source = { ...pane.location, path: entry.path, version: entry.version };
          const projected = buffersRef.current.map((b) => relocateBuffer(b, source, { path, version: entry.version }));
          if (new Set(projected.map((b) => b.id)).size !== projected.length)
            throw new Error('Close the open destination document before renaming');
          const renamed = await files.rename({ ...source, destination: path });
          const current = buffersRef.current.find((b) => b.id === editorId);
          if (current) setEditorId(relocateBuffer(current, source, renamed).id);
          setBuffers((all) => all.map((b) => relocateBuffer(b, source, renamed)));
        }
        if (pending.action === 'create' || pending.action === 'saveCopy')
          await files.saveText({
            ...pane.location,
            path,
            content: pending.buffer?.text ?? '',
            version: null,
            bom: pending.buffer?.document.bom ?? false,
          });
      }
      setPending(null);
      refresh();
    });
  const upload = async (file: File) => {
    const pane = uploadTarget.current;
    if (!pane || browserTransfer) return;
    let id: string | undefined,
      committing = false;
    cancelled.current = false;
    setError('');
    setBrowserTransfer({ label: `Upload ${file.name}`, bytes: 0, total: file.size, committing: false });
    try {
      id = crypto.randomUUID();
      const session = await files.beginUpload({
        id,
        ...pane.location,
        path: joinPath(pane.location.path, fileName(file.name)),
        size: file.size,
      });
      id = session.id;
      for (let offset = 0; offset < file.size;) {
        if (cancelled.current) throw new Error('Upload cancelled');
        const bytes = new Uint8Array(await file.slice(offset, offset + 256 * 1024).arrayBuffer());
        const ack = await files.uploadChunk({
          nodeId: pane.location.nodeId,
          id,
          offset,
          ...(await encodeChunk(bytes)),
        });
        offset = ack.offset;
        setBrowserTransfer({ label: `Upload ${file.name}`, bytes: offset, total: file.size, committing: false });
      }
      if (cancelled.current) throw new Error('Upload cancelled');
      committing = true;
      setBrowserTransfer({ label: `Publishing ${file.name}`, bytes: file.size, total: file.size, committing: true });
      await files.finishUpload({ nodeId: pane.location.nodeId, id });
      await files.acknowledgeUpload({ nodeId: pane.location.nodeId, id }).catch(() => undefined);
      refresh();
    } catch (e) {
      if (id && !committing) {
        try {
          await files.abortUpload({ nodeId: pane.location.nodeId, id });
        } catch {
          setError(`Upload interrupted; staging receipt ${id} requires reconciliation`);
          return;
        }
      }
      setError(
        `${describeFileError(e)}${id && committing ? ` · Publication outcome unknown; receipt ${id}. Do not upload a replacement until checked.` : ''}`
      );
    } finally {
      setBrowserTransfer(null);
    }
  };
  const download = async (pane: PaneSelection) => {
    const entry = pane.entries[0];
    if (!entry || browserTransfer) return;
    // The portable browser fallback is bounded; server-to-server transfers never buffer the file here.
    if (entry.size > 32 * 1024 * 1024) {
      setError('Browser downloads are limited to 32 MiB. Use server-to-server copy or the CLI for larger files.');
      return;
    }
    cancelled.current = false;
    setError('');
    setBrowserTransfer({ label: `Download ${entry.name}`, bytes: 0, total: entry.size, committing: false });
    try {
      const chunks: ArrayBuffer[] = [];
      let offset = 0;
      while (offset < entry.size) {
        if (cancelled.current) throw new Error('Download cancelled');
        const frame = await files.readChunk({ ...pane.location, path: entry.path, version: entry.version, offset });
        const bytes = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
        if (!bytes.length || frame.offset !== offset || (await encodeChunk(bytes)).sha256 !== frame.sha256)
          throw new Error('Download checksum or sequence mismatch');
        chunks.push(bytes.buffer);
        offset += bytes.length;
        setBrowserTransfer({ label: `Download ${entry.name}`, bytes: offset, total: entry.size, committing: false });
      }
      const url = URL.createObjectURL(new Blob(chunks, { type: 'application/octet-stream' })),
        a = document.createElement('a');
      a.href = url;
      a.download = entry.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(describeFileError(e));
    } finally {
      setBrowserTransfer(null);
    }
  };
  const retainedPending = useRef(pending);
  if (pending) retainedPending.current = pending;
  const dialogPending = pending ?? retainedPending.current;
  const namedAction = pending && ['mkdir', 'rename', 'create', 'saveCopy'].includes(pending.action);
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        gap: 1,
        '@media (max-height: 600px)': { overflowY: 'auto' },
      }}
    >
      <Breadcrumbs
        heading="Files"
        active={visible}
        links={[{ name: 'Files' }]}
        action={
          <Stack direction="row" spacing={0.75}>
            {buffers.length > 0 && (
              <Button size="small" onClick={() => setEditorOpen(true)}>
                Editor · {buffers.length}
                {buffers.some((b) => b.text !== b.document.content) ? ' •' : ''}
              </Button>
            )}
            <Button size="small" variant={unfinished.length ? 'outlined' : 'text'} onClick={() => setQueueOpen(true)}>
              Transfers{unfinished.length ? ` · ${unfinished.length}` : ''}
            </Button>
          </Stack>
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ overflowWrap: 'anywhere' }}>
          {error}
        </Alert>
      )}
      {jobs.error && <Alert severity="warning">Transfer status unavailable: {jobs.error}</Alert>}
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
        {compact && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={active}
            onChange={(_, v) => {
              if (v) setActive(v);
            }}
            aria-label="Visible file panel"
          >
            <ToggleButton value="left">A</ToggleButton>
            <ToggleButton value="right">B</ToggleButton>
          </ToggleButtonGroup>
        )}
        <Button
          size="small"
          variant="outlined"
          disabled={!selected?.entries.length || !other || other.root.readOnly || busy}
          onClick={() => action(active, 'copy')}
        >
          {active === 'left' ? 'Copy A → B' : 'Copy B → A'}
        </Button>
        <Button
          size="small"
          disabled={!selected || selected.root.readOnly || busy}
          onClick={() => action(active, 'mkdir')}
        >
          New folder
        </Button>
        <Button
          size="small"
          disabled={!selected || selected.root.readOnly || Boolean(browserTransfer)}
          onClick={() => action(active, 'upload')}
        >
          Upload
        </Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Tab switches A/B · F6 changes region · Arrows browse · Enter opens · Space selects · Shift+click selects a range · Alt+arrows navigate · F2 renames · F4 edits · F5 copies · Delete moves to trash">
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: { xs: 'none', lg: 'block' }, fontFamily: 'monospace' }}
          >
            A ↔ B · FILES
          </Typography>
        </Tooltip>
      </Stack>
      {browserTransfer && (
        <Box role="status">
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" sx={{ flex: 1 }}>
              {browserTransfer.label} · {fileBytes(browserTransfer.bytes)} / {fileBytes(browserTransfer.total)}
            </Typography>
            <Button
              size="small"
              disabled={browserTransfer.committing}
              onClick={() => {
                cancelled.current = true;
              }}
            >
              Cancel
            </Button>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={browserTransfer.total ? (browserTransfer.bytes / browserTransfer.total) * 100 : 0}
          />
        </Box>
      )}
      <Box ref={workspace} sx={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 240, overflow: 'hidden' }}>
        {hosts.length > 0 ? (
          <>
            <Box
              sx={{
                display: compact && active !== 'left' ? 'none' : 'flex',
                flex: compact ? 1 : `0 0 ${split}%`,
                minWidth: 0,
                minHeight: 0,
              }}
            >
              <FilePane
                side="left"
                visible={visible}
                hosts={hosts}
                active={active === 'left'}
                hidden={false}
                refreshKey={refreshKey}
                onFocus={() => setActive('left')}
                onSwitchPanel={() => focusPane('right')}
                onSelection={(value) => setPanes((p) => ({ ...p, left: value }))}
                onOpen={(...args) => void open(...args)}
                onAction={(key) => action('left', key)}
              />
            </Box>
            {!compact && (
              <Box
                role="separator"
                aria-label="Panel width"
                aria-orientation="vertical"
                aria-valuemin={30}
                aria-valuemax={70}
                aria-valuenow={split}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    setSplit((v) => Math.max(30, Math.min(70, v + (e.key === 'ArrowLeft' ? -2 : 2))));
                  }
                }}
                onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const rect = workspace.current!.getBoundingClientRect();
                  setSplit(Math.max(30, Math.min(70, ((e.clientX - rect.left) / rect.width) * 100)));
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId))
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                sx={{
                  width: 8,
                  flexShrink: 0,
                  cursor: 'col-resize',
                  touchAction: 'none',
                  '&:hover, &:focus-visible': { bgcolor: 'action.hover', outlineColor: 'primary.main' },
                }}
              />
            )}
            <FilePane
              side="right"
              visible={visible}
              hosts={hosts}
              active={active === 'right'}
              hidden={compact && active !== 'right'}
              refreshKey={refreshKey}
              onFocus={() => setActive('right')}
              onSwitchPanel={() => focusPane('left')}
              onSelection={(value) => setPanes((p) => ({ ...p, right: value }))}
              onOpen={(...args) => void open(...args)}
              onAction={(key) => action('right', key)}
            />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Loading registered nodes…
          </Typography>
        )}
      </Box>
      {running.length > 0 && (
        <Button size="small" onClick={() => setQueueOpen(true)} sx={{ justifyContent: 'flex-start' }}>
          <Box sx={{ width: 80, mr: 1 }}>
            <LinearProgress />
          </Box>
          {running.length} active transfer{running.length === 1 ? '' : 's'}
        </Button>
      )}
      <input
        ref={uploadInput}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
      <Dialog
        open={Boolean(namedAction)}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {dialogPending?.action === 'mkdir'
            ? 'New folder'
            : dialogPending?.action === 'rename'
              ? 'Rename'
              : dialogPending?.action === 'saveCopy'
                ? 'Save a copy'
                : 'New file'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="caption" sx={{ display: 'block', mb: 2, overflowWrap: 'anywhere' }}>
            {pending && label(pending.pane.location)}
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name && !busy) void confirm();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" disabled={!name || busy} onClick={() => void confirm()}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={Boolean(pending && !namedAction)}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        loading={busy}
        title={dialogPending?.action === 'copy' ? 'Copy to destination' : 'Move to trash'}
        confirmLabel={dialogPending?.action === 'copy' ? 'Start copy' : 'Move to trash'}
        confirmColor={pending?.action === 'copy' ? 'primary' : 'warning'}
        disabled={pending?.action === 'copy' && (!pending.destination || pending.destination.root.readOnly)}
        onConfirm={confirm}
        content={
          <Stack spacing={1}>
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {pending && label(pending.pane.location)}
            </Typography>
            <Box sx={{ maxHeight: 160, overflow: 'auto' }}>
              {pending?.pane.entries.map((e) => (
                <Typography key={e.path} variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                  {e.name}
                </Typography>
              ))}
            </Box>
            {pending?.action === 'copy' ? (
              <>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere', fontWeight: 600 }}>
                  → {pending.destination ? label(pending.destination.location) : 'Select the other panel destination'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Existing files are never overwritten. Completed files remain if a later file fails or the transfer is
                  cancelled.
                </Typography>
              </>
            ) : (
              <Typography variant="body2">
                Items can be restored from this panel’s trash menu. Space is retained on the source node.
              </Typography>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        }
      />
      <Drawer
        anchor="right"
        open={queueOpen && visible}
        onClose={() => setQueueOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 }, maxWidth: '100%' } } }}
      >
        <Stack direction="row" sx={{ p: 2, alignItems: 'center' }}>
          <Typography sx={{ flex: 1, fontWeight: 600 }}>Transfers</Typography>
          <IconButton aria-label="Close transfers" onClick={() => setQueueOpen(false)}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ px: 2, pb: 2 }}>
          Node transfers run in daemon. Interrupted jobs resume only on your command.
        </Typography>
        {jobs.error && <Alert severity="error">{jobs.error}</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        {!jobs.data?.length && (
          <Typography color="text.secondary" sx={{ p: 2 }}>
            No transfers yet
          </Typography>
        )}
        {(jobs.data ?? []).map((job) => (
          <Box key={job.id} sx={{ p: 2, borderTop: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                {job.source.map((s) => s.path.split('/').at(-1)).join(', ')}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                color={
                  job.state === 'failed' || job.state === 'interrupted'
                    ? 'warning'
                    : job.state === 'completed'
                      ? 'success'
                      : 'default'
                }
                label={job.state}
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {job.source
                .map((s) => hostName(s.nodeId))
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(', ')}{' '}
              → {label(job.destination)}
            </Typography>
            <LinearProgress
              sx={{ my: 1 }}
              variant={job.state === 'planning' ? 'indeterminate' : 'determinate'}
              value={
                job.totalBytes ? Math.min(100, (job.bytes / job.totalBytes) * 100) : job.state === 'completed' ? 100 : 0
              }
            />
            <Typography variant="caption">
              {fileBytes(job.bytes)} / {fileBytes(job.totalBytes)} · {job.completedFiles} / {job.totalFiles} files
            </Typography>
            {job.currentPath && (
              <Typography variant="caption" sx={{ display: 'block' }} color="text.secondary">
                {job.currentPath}
              </Typography>
            )}
            {job.error && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {job.error}
              </Alert>
            )}
            <Stack direction="row" spacing={1}>
              {['running', 'planning'].includes(job.state) && (
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await files.controlTransfer({ id: job.id, action: 'pause' });
                      await jobs.refresh();
                    })
                  }
                >
                  Pause
                </Button>
              )}
              {['paused', 'failed', 'interrupted'].includes(job.state) && (
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await files.controlTransfer({ id: job.id, action: 'resume' });
                      await jobs.refresh();
                    })
                  }
                >
                  Resume
                </Button>
              )}
              {!['completed', 'cancelled'].includes(job.state) && (
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await files.controlTransfer({ id: job.id, action: 'cancel' });
                      await jobs.refresh();
                      refresh();
                    })
                  }
                >
                  Cancel
                </Button>
              )}
            </Stack>
          </Box>
        ))}
      </Drawer>
      <Dialog open={Boolean(trash) && visible} onClose={() => setTrash(null)} fullWidth maxWidth="sm">
        <DialogTitle>Restore from trash</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error">{error}</Alert>}
          {!trash?.items.length && <Typography color="text.secondary">Trash is empty</Typography>}
          {trash?.items.map((item) => (
            <Stack key={item.id} direction="row" spacing={1} sx={{ alignItems: 'center', py: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                  {item.path}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(item.removedAt).toLocaleString()}
                </Typography>
              </Box>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await files.restore({ nodeId: trash.pane.location.nodeId, id: item.id });
                    setTrash({ ...trash, items: await files.trashList(trash.pane.location) });
                    refresh();
                  })
                }
              >
                Restore
              </Button>
            </Stack>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrash(null)}>Close</Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={editorOpen && visible && Boolean(buffer)}
        onClose={() => setEditorOpen(false)}
        fullScreen={compact}
        maxWidth="xl"
        fullWidth
        keepMounted
        slotProps={{ paper: { sx: { height: compact ? '100%' : '86dvh', minHeight: 0, overflow: 'hidden' } } }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ px: 1, alignItems: 'center', borderBottom: 1, borderColor: 'divider', minWidth: 0 }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Tabs
              value={editorId}
              onChange={setEditorId}
              onClose={(id) => closeBuffer(id)}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="Open files"
              tabs={buffers.map((b) => ({
                value: b.id,
                label: `${b.location.path.split('/').at(-1)}${b.text !== b.document.content ? ' •' : ''}`,
                closable: true,
                closeDisabled: busy,
                closeLabel: `Close file ${b.location.path}`,
              }))}
            />
          </Box>
          <Tooltip title="Minimize editor; buffers stay open">
            <IconButton aria-label="Minimize editor" onClick={() => setEditorOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Stack>
        {buffer && (
          <>
            <Stack direction="row" spacing={1} sx={{ p: 1, alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}>
              <Typography
                variant="caption"
                sx={{ flex: 1, minWidth: 160, overflowWrap: 'anywhere', fontFamily: 'monospace' }}
              >
                {label(buffer.location)}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={buffer.readOnly ? 'Read only' : buffer.text !== buffer.document.content ? 'Unsaved' : 'Saved'}
              />
              <Button
                size="small"
                disabled={busy || buffer.readOnly || lineEnding(buffer.text) === 'mixed'}
                onClick={() => {
                  setEditorOpen(false);
                  setName(buffer.location.path.split('/').at(-1) + '.copy');
                  setPending({
                    action: 'saveCopy',
                    pane: {
                      location: { ...buffer.location, path: buffer.location.path.split('/').slice(0, -1).join('/') },
                      root: { id: buffer.location.rootId, label: buffer.location.rootId, readOnly: false },
                      entries: [],
                    },
                    buffer,
                  });
                }}
              >
                Save copy
              </Button>
              <Button size="small" disabled={busy} onClick={() => setReloadBuffer(buffer.id)}>
                Reload
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={
                  busy ||
                  buffer.readOnly ||
                  buffer.text === buffer.document.content ||
                  lineEnding(buffer.text) === 'mixed'
                }
                onClick={() => void save(buffer)}
              >
                Save
              </Button>
            </Stack>
            {error && (
              <Alert severity="error" onClose={() => setError('')}>
                {error}
              </Alert>
            )}
            {lineEnding(buffer.text) === 'mixed' && (
              <Alert severity="info">Mixed line endings: preview is read only to preserve the original bytes.</Alert>
            )}
          </>
        )}
        <Suspense fallback={<LinearProgress />}>
          {buffers.map((b) => (
            <Box key={b.id} sx={{ display: b.id === editorId ? 'flex' : 'none', flex: 1, minHeight: 0, minWidth: 0 }}>
              <CodeEditor
                key={`${b.id}:${b.revision}`}
                initial={b.text}
                name={b.location.path}
                readOnly={b.readOnly}
                onChange={(text) =>
                  setBuffers((all) => all.map((item) => (item.id === b.id ? { ...item, text } : item)))
                }
                onSave={() => {
                  const current = buffersRef.current.find((item) => item.id === b.id);
                  if (current && !busy) void save(current);
                }}
              />
            </Box>
          ))}
        </Suspense>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 2, py: 0.5, borderTop: 1, borderColor: 'divider' }}
        >
          UTF-8{buffer?.document.bom ? ' BOM' : ''} ·{' '}
          {buffer ? fileBytes(new TextEncoder().encode(buffer.text).length) : ''} · Ctrl/⌘+S save · Ctrl/⌘+F find ·
          changes checked against the file version
        </Typography>
      </Dialog>
      <ConfirmDialog
        open={Boolean(reloadBuffer)}
        title="Reload the saved file?"
        content="This replaces the editor buffer with the current file on the node. Unsaved text will be discarded."
        confirmLabel="Reload"
        loading={busy}
        onClose={() => setReloadBuffer(null)}
        onConfirm={() =>
          act(async () => {
            const current = buffersRef.current.find((b) => b.id === reloadBuffer);
            if (!current) return;
            const document = await files.readText(current.location);
            setBuffers((all) =>
              all.map((b) =>
                b.id === current.id ? { ...b, document, text: document.content, revision: b.revision + 1 } : b
              )
            );
            setReloadBuffer(null);
          })
        }
      />
      <ConfirmDialog
        open={Boolean(discard)}
        title="Discard unsaved changes?"
        content="The saved file will remain unchanged. This editor buffer will be closed."
        confirmLabel="Discard"
        confirmColor="warning"
        onClose={() => setDiscard(null)}
        onConfirm={() => {
          if (discard) closeBuffer(discard, true);
        }}
      />
    </Box>
  );
}
