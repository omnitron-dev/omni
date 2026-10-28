import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Breadcrumbs } from '@omnitron-dev/prism/components/breadcrumbs';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import type { TerminalSession, TerminalHostKey, TerminalPolicy } from '@omnitron-dev/omnitron/dto/services';
import { nodes, terminal } from 'src/netron/client';
import { useAuthStore } from 'src/auth/store';
import { encodeTerminalInput, requiresPasteReview, secureTerminalOrigin, visiblePaste, terminalCommand } from 'src/utils/terminal-input';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
type RemoteNode = { id: string; name: string; host: string; sshUser: string };
const MAX_WORKSPACE_TABS = 32;

/** Kept mounted by ConsoleLayout: navigating to logs does not destroy SSH tabs. */
export default function TerminalPage({ visible = true }: { visible?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const secure = secureTerminalOrigin(window.location);
  const [params] = useSearchParams();
  const [available, setAvailable] = useState<RemoteNode[]>([]);
  const [policy, setPolicy] = useState<TerminalPolicy | null>(null);
  const [nodeId, setNodeId] = useState(params.get('node') ?? '');
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [active, setActive] = useState('');
  const [split, setSplit] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState<TerminalHostKey | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const mounted = useRef(false);
  const generation = useRef(0);
  const { copy } = useCopyToClipboard();

  useEffect(() => {
    mounted.current = true;
    const run = ++generation.current;
    if (secure && user?.role === 'admin') {
      void Promise.all([nodes.listNodes(), terminal.capabilities()])
        .then(([list, caps]) => {
          if (!mounted.current || run !== generation.current) return;
          const remote = list.filter((n) => !n.isLocal);
          setAvailable(remote);
          setPolicy(caps);
          setNodeId((id) => (remote.some((n) => n.id === id) ? id : (remote[0]?.id ?? '')));
        })
        .catch((e) => {
          if (mounted.current && run === generation.current) setError(message(e));
        });
    }
    return () => {
      mounted.current = false;
      for (const session of sessionsRef.current)
        if (session.state !== 'closed') void terminal.close({ id: session.id }).catch(() => undefined);
    };
  }, [user?.id, user?.role, secure]);

  useEffect(() => {
    const id = params.get('node');
    if (id && available.some((n) => n.id === id)) setNodeId(id);
  }, [params, available]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (sessionsRef.current.some((s) => s.state !== 'closed')) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const update = useCallback(
    (session: TerminalSession) => setSessions((all) => all.map((s) => (s.id === session.id ? session : s))),
    []
  );
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const open = () =>
    act(async () => {
      if (sessionsRef.current.length >= MAX_WORKSPACE_TABS)
        throw new Error('Close an existing tab before opening another (32 tabs per workspace).');
      const session = await terminal.open({ nodeId, cols: 100, rows: 28 });
      if (!mounted.current) {
        await terminal.close({ id: session.id });
        return;
      }
      setSessions((all) => [...all, session]);
      setActive(session.id);
    });
  const inspect = () =>
    act(async () => {
      const key = await terminal.inspectHost({ nodeId });
      setHost(key);
      setFingerprint('');
    });
  const trust = () =>
    act(async () => {
      if (!host) return;
      await terminal.trustHost({ nodeId: host.nodeId, fingerprint: fingerprint.trim(), previous: host.trusted });
      setHost(null);
    });
  const close = () =>
    act(async () => {
      if (!pendingClose) return;
      await terminal.close({ id: pendingClose });
      setSessions((all) => all.filter((s) => s.id !== pendingClose));
      if (active === pendingClose) setActive(sessions.find((s) => s.id !== pendingClose)?.id ?? '');
      setPendingClose(null);
    });

  if (user?.role !== 'admin') return <Alert severity="info">SSH terminals require an administrator account.</Alert>;
  if (!secure)
    return (
      <Alert severity="error">
        Open this Console over HTTPS to use SSH terminals. Plain HTTP is allowed only on loopback for local development.
      </Alert>
    );
  const second = split ? sessions.find((s) => s.id !== active)?.id : undefined;
  const current = sessions.find((s) => s.id === active);
  return (
    <Box>
      <Breadcrumbs heading="SSH workspace" links={[{ name: 'Infrastructure' }, { name: 'Terminal' }]} />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        One session per tab. SSH credentials stay in the daemon. Tabs stay connected while you navigate this Console.
      </Typography>
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Card sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            select
            label="SSH node"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            size="small"
            sx={{ minWidth: 240 }}
          >
            {available.map((n) => (
              <MenuItem key={n.id} value={n.id}>
                {n.name} · {n.sshUser}@{n.host}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            disabled={
              busy ||
              !policy ||
              !nodeId ||
              sessions.length >= MAX_WORKSPACE_TABS ||
              sessions.filter((s) => s.state !== 'closed').length >= policy.maxSessionsPerOwner
            }
            onClick={open}
          >
            New SSH tab
          </Button>
          <Button disabled={busy || !policy || !nodeId} onClick={inspect}>
            Verify host key
          </Button>
          <Button disabled={sessions.length < 2} aria-pressed={split} onClick={() => setSplit((v) => !v)}>
            {split ? 'Single pane' : 'Split view'}
          </Button>
          <Button component={Link} to="/audit">
            Audit
          </Button>
          <Button disabled={!nodeId} onClick={() => void copy(terminalCommand(nodeId))}>
            Copy CLI command
          </Button>
        </Stack>
        {policy && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {sessions.filter((s) => s.state !== 'closed').length}/{policy.maxSessionsPerOwner} open · idle timeout{' '}
            {Math.round(policy.idleTimeoutMs / 60_000)} min · disconnected clients close after{' '}
            {Math.round(policy.disconnectTimeoutMs / 1000)} s
          </Typography>
        )}
      </Card>
      {sessions.length === 0 ? (
        <Alert severity="info">
          Select a registered node, verify its SSH host key, then open a tab. The shell has the permissions of that
          node’s SSH user.
        </Alert>
      ) : (
        <>
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
            <Tabs
              value={active || false}
              onChange={(_, id: string) => setActive(id)}
              variant="scrollable"
              scrollButtons="auto"
              aria-label="SSH sessions"
              sx={{ flex: 1 }}
            >
              {sessions.map((s, i) => (
                <Tab
                  key={s.id}
                  value={s.id}
                  label={`${s.nodeName} ${i + 1}${s.state === 'closed' ? ' · closed' : ''}`}
                />
              ))}
            </Tabs>
            <Button color="warning" disabled={!current || busy} onClick={() => setPendingClose(active)}>
              Close tab
            </Button>
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: second ? { xs: '1fr', lg: '1fr 1fr' } : '1fr', gap: 1 }}>
            {sessions.map((session) => (
              <TerminalPane
                key={session.id}
                session={session}
                visible={visible && (session.id === active || session.id === second)}
                update={update}
              />
            ))}
          </Box>
        </>
      )}
      <Dialog open={host !== null} onClose={() => !busy && setHost(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Verify SSH host identity</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Compare this fingerprint with a trusted console or inventory for {host?.host}:{host?.port}. A network
            observation alone does not establish trust.
          </Typography>
          <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13 }}>
            {host?.observed}
          </Typography>
          {host?.trusted && (
            <Alert severity={host.trusted === host.observed ? 'success' : 'error'} sx={{ mb: 2 }}>
              {host.trusted === host.observed
                ? 'Matches the stored fingerprint.'
                : 'The host key changed. Verify the replacement independently before updating trust.'}
            </Alert>
          )}
          <TextField
            fullWidth
            label="Independently verified SHA256 fingerprint"
            value={fingerprint}
            onChange={(e) => setFingerprint(e.target.value)}
            sx={{ mt: 2 }}
          />
          <Typography variant="caption">Changing trust closes existing terminal sessions to this node.</Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setHost(null)}>
            Cancel
          </Button>
          <Button disabled={busy || !host || fingerprint.trim() !== host.observed} onClick={trust}>
            Trust verified key
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={pendingClose !== null} onClose={() => !busy && setPendingClose(null)}>
        <DialogTitle>Close SSH session?</DialogTitle>
        <DialogContent>
          The remote shell will disconnect. Foreground commands may stop; use a remote session manager for work that
          must survive disconnects.
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setPendingClose(null)}>
            Cancel
          </Button>
          <Button disabled={busy} color="warning" onClick={close}>
            Close session
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function TerminalPane({
  session,
  visible,
  update,
}: {
  session: TerminalSession;
  visible: boolean;
  update: (s: TerminalSession) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const emulator = useRef<Terminal | null>(null);
  const fitter = useRef<FitAddon | null>(null);
  const finder = useRef<SearchAddon | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [paste, setPaste] = useState<string | null>(null);
  const [pasteNotice, setPasteNotice] = useState('');
  const { copy } = useCopyToClipboard();

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      scrollback: 5000,
      screenReaderMode: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      theme: { background: '#080c15', foreground: '#dce5ee', cursor: '#54e6c5', selectionBackground: '#28584e' },
      linkHandler: { activate: () => undefined },
      windowOptions: {},
      allowProposedApi: false,
    });
    const fit = new FitAddon(),
      search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    // Remote output cannot write the browser clipboard or create actionable hyperlinks.
    term.parser.registerOscHandler(52, () => true);
    term.parser.registerOscHandler(8, () => true);
    term.open(host.current);
    emulator.current = term;
    fitter.current = fit;
    finder.current = search;
    let disposed = false,
      failed = false,
      sequence = 0,
      cursor = 0,
      queuedBytes = 0,
      sending = false;
    const pending: Uint8Array[] = [];
    let sendTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: unknown) => {
      if (disposed || failed) return;
      failed = true;
      pending.length = 0;
      queuedBytes = 0;
      term.options.disableStdin = true;
      setError(message(e));
      void terminal.close({ id: session.id }).catch(() => undefined);
    };
    const flush = async () => {
      if (sending || disposed || failed || !pending.length) return;
      sending = true;
      try {
        while (pending.length && !disposed && !failed) {
          // Batch individual key events into one RPC without changing byte order.
          const chunk = new Uint8Array(Math.min(8192, queuedBytes));
          let offset = 0;
          while (offset < chunk.length) {
            const bytes = pending.shift()!;
            const count = Math.min(bytes.length, chunk.length - offset);
            chunk.set(bytes.subarray(0, count), offset);
            offset += count;
            if (bytes.length > count) pending.unshift(bytes.subarray(count));
          }
          queuedBytes -= chunk.length;
          const answer = await terminal.write({ id: session.id, sequence, data: encodeTerminalInput(chunk) });
          sequence = answer.nextSequence;
        }
      } catch (e) {
        fail(e);
      } finally {
        sending = false;
      }
    };
    const enqueue = (value: Uint8Array) => {
      if (failed || disposed) return;
      if (queuedBytes + value.length > 32768) {
        fail(new Error('Input queue exceeded 32 KiB; session closed without replaying queued input.'));
        return;
      }
      pending.push(value);
      queuedBytes += value.length;
      clearTimeout(sendTimer);
      sendTimer = setTimeout(() => void flush(), 16);
    };
    const input = term.onData((value) => enqueue(new TextEncoder().encode(value)));
    const binaryInput = term.onBinary((value) => enqueue(Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff)));
    const resize = term.onResize(({ cols, rows }) => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!disposed && !failed) void terminal.resize({ id: session.id, cols, rows }).catch(fail);
      }, 100);
    });
    const pasted = (e: ClipboardEvent) => {
      const value = e.clipboardData?.getData('text/plain') ?? '';
      if (new TextEncoder().encode(value).length > 32768 || requiresPasteReview(value)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (new TextEncoder().encode(value).length > 32768)
          setPasteNotice('Paste is limited to 32 KiB. Paste a smaller selection.');
        else setPaste(value);
      }
    };
    host.current.addEventListener('paste', pasted, true);
    const element = host.current;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth && element.clientHeight) fit.fit();
    });
    observer.observe(element);
    void (async () => {
      // StrictMode may tear this effect down before the first request is sent.
      await Promise.resolve();
      while (!disposed && !failed) {
        try {
          const answer = await terminal.read({ id: session.id, cursor });
          if (disposed) return;
          if (answer.droppedBytes)
            term.writeln(`\r\n[${answer.droppedBytes} bytes no longer retained by the server]\r\n`);
          const bytes = Uint8Array.from(atob(answer.data), (c) => c.charCodeAt(0));
          if (bytes.length) await new Promise<void>((done) => term.write(bytes, done));
          cursor = answer.cursor;
          update(answer.session);
          if (answer.session.state === 'closed' && !answer.hasMore) {
            term.options.disableStdin = true;
            return;
          }
        } catch (e) {
          fail(e);
          return;
        }
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(sendTimer);
      clearTimeout(resizeTimer);
      observer.disconnect();
      element.removeEventListener('paste', pasted, true);
      input.dispose();
      binaryInput.dispose();
      resize.dispose();
      term.dispose();
      emulator.current = null;
      fitter.current = null;
      finder.current = null;
    };
  }, [session.id, update]);

  useEffect(() => {
    if (visible) {
      fitter.current?.fit();
      emulator.current?.focus();
    }
  }, [visible]);
  useEffect(() => {
    if (emulator.current)
      emulator.current.options.disableStdin = readOnly || session.state !== 'open' || Boolean(error);
  }, [readOnly, session.state, error]);
  useEffect(() => {
    if (emulator.current) {
      emulator.current.options.fontSize = fontSize;
      if (visible) fitter.current?.fit();
    }
  }, [fontSize, visible]);

  return (
    <Card sx={{ display: visible ? 'block' : 'none', minWidth: 0, p: 1 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
        <Typography variant="caption" sx={{ fontFamily: 'monospace', flex: 1 }}>
          {session.username}@{session.host}
        </Typography>
        <Chip
          size="small"
          label={session.state === 'closed' ? (session.reason ?? 'closed') : session.state}
          color={session.state === 'open' ? 'success' : 'default'}
        />
        <Button size="small" aria-pressed={readOnly} onClick={() => setReadOnly((v) => !v)}>
          {readOnly ? 'Enable input' : 'Read only'}
        </Button>
        <Button size="small" onClick={() => void copy(emulator.current?.getSelection() ?? '')}>
          Copy selection
        </Button>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      {pasteNotice && (
        <Alert severity="warning" onClose={() => setPasteNotice('')} sx={{ mb: 1 }}>
          {pasteNotice}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          label="Find in scrollback"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finder.current?.findNext(query);
          }}
          sx={{ flex: 1 }}
        />
        <Button size="small" disabled={!query} onClick={() => finder.current?.findPrevious(query)}>
          Previous
        </Button>
        <Button size="small" disabled={!query} onClick={() => finder.current?.findNext(query)}>
          Next
        </Button>
        <Button
          size="small"
          aria-label="Decrease terminal font"
          onClick={() => setFontSize((v) => Math.max(10, v - 1))}
        >
          A−
        </Button>
        <Button
          size="small"
          aria-label="Increase terminal font"
          onClick={() => setFontSize((v) => Math.min(24, v + 1))}
        >
          A+
        </Button>
      </Stack>
      <Box
        ref={host}
        aria-label={`Terminal on ${session.nodeName}`}
        sx={{ height: 'min(65vh, 720px)', minHeight: 300, bgcolor: '#080c15', p: 1, '& .xterm': { height: '100%' } }}
      />
      <Dialog open={paste !== null} onClose={() => setPaste(null)} fullWidth maxWidth="md">
        <DialogTitle>Review terminal paste</DialogTitle>
        <DialogContent>
          <Alert severity="warning">
            This text contains line breaks or control characters and may execute commands immediately.
          </Alert>
          <Box
            component="pre"
            sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 320, overflow: 'auto' }}
          >
            {visiblePaste(paste ?? '')}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaste(null)}>Cancel</Button>
          <Button
            color="warning"
            disabled={readOnly || session.state !== 'open' || Boolean(error)}
            onClick={() => {
              emulator.current?.paste(paste ?? '');
              setPaste(null);
            }}
          >
            Paste into shell
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
