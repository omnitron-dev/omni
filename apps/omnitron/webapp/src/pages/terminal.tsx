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
  Menu,
  IconButton,
  Tooltip,
  ToggleButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { AddIcon, MoreIcon, SearchIcon, CloseIcon, ArrowUpIcon, ArrowDownIcon } from '@omnitron-dev/prism/icons';
import { alpha, useTheme } from '@mui/material/styles';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import type { TerminalSession, TerminalHostKey, TerminalPolicy } from '@omnitron-dev/omnitron/dto/services';
import { nodes, terminal } from 'src/netron/client';
import { useAuthStore } from 'src/auth/store';
import {
  encodeTerminalInput,
  requiresPasteReview,
  secureTerminalOrigin,
  visiblePaste,
  terminalCommand,
} from 'src/utils/terminal-input';

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
  const [pendingCloseLabel, setPendingCloseLabel] = useState('SSH session');
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const newTabButton = useRef<HTMLButtonElement>(null);
  const tabNumbers = useRef(new Map<string, number>());
  const nextTabNumber = useRef(1);
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
      tabNumbers.current.set(session.id, nextTabNumber.current++);
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
      const index = sessions.findIndex((s) => s.id === pendingClose);
      if (active === pendingClose) setActive((sessions[index + 1] ?? sessions[index - 1])?.id ?? '');
      tabNumbers.current.delete(pendingClose);
      if (sessions.length <= 2) setSplit(false);
      if (sessions.length === 1) requestAnimationFrame(() => newTabButton.current?.focus());
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
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        gap: 1,
        containerType: 'size',
        containerName: 'ssh-workspace',
      }}
    >
      <Breadcrumbs
        active={visible}
        heading="SSH workspace"
        links={[{ name: 'Infrastructure', href: '/nodes' }, { name: 'Terminal' }]}
        action={
          policy && (
            <Tooltip
              title={`Idle timeout ${Math.round(policy.idleTimeoutMs / 60_000)} min. Disconnected clients close after ${Math.round(policy.disconnectTimeoutMs / 1000)} s. Credentials stay in the daemon.`}
            >
              <Typography
                variant="caption"
                tabIndex={0}
                sx={{ color: 'text.secondary', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
              >
                {sessions.filter((s) => s.state !== 'closed').length}/{policy.maxSessionsPerOwner}
                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                  {' '}
                  sessions
                </Box>
              </Typography>
            </Tooltip>
          )
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ flexShrink: 0, overflowWrap: 'anywhere' }}>
          {error}
        </Alert>
      )}
      <Card variant="outlined" sx={{ p: 0.75, flexShrink: 0, borderRadius: 1, boxShadow: 'none', overflow: 'visible' }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
          <TextField
            select
            label="SSH node"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            size="small"
            sx={{
              flex: 1,
              minWidth: 0,
              '& .MuiSelect-select': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }}
          >
            {available.map((n) => (
              <MenuItem key={n.id} value={n.id}>
                {n.name} · {n.sshUser}@{n.host}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="contained"
            aria-label="New SSH tab"
            ref={newTabButton}
            startIcon={<AddIcon />}
            onClick={open}
            sx={{
              minWidth: { xs: 36, sm: 112 },
              height: 36,
              whiteSpace: 'nowrap',
              '& .MuiButton-startIcon': { m: { xs: 0, sm: undefined } },
            }}
            disabled={
              busy ||
              !policy ||
              !nodeId ||
              sessions.length >= MAX_WORKSPACE_TABS ||
              sessions.filter((s) => s.state !== 'closed').length >= policy.maxSessionsPerOwner
            }
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              New SSH tab
            </Box>
          </Button>
          <Tooltip title={second ? 'Show only the selected tab' : 'Show two sessions in split view'}>
            <span>
              <ToggleButton
                value="split"
                size="small"
                aria-label="Split view"
                selected={Boolean(second)}
                disabled={sessions.length < 2}
                onClick={() => setSplit((v) => !v)}
                color="primary"
                sx={{ whiteSpace: 'nowrap', height: 36, px: 1 }}
              >
                {second ? '2 panes' : '1 pane'}
              </ToggleButton>
            </span>
          </Tooltip>
          <Tooltip title="Workspace actions">
            <IconButton
              aria-label="Workspace actions"
              aria-haspopup="menu"
              aria-expanded={Boolean(menu)}
              onClick={(e) => setMenu(e.currentTarget)}
            >
              <MoreIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Card>
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          disabled={busy || !policy || !nodeId}
          onClick={() => {
            setMenu(null);
            void inspect();
          }}
        >
          Verify host key
        </MenuItem>
        <MenuItem
          disabled={!nodeId}
          onClick={() => {
            setMenu(null);
            void copy(terminalCommand(nodeId));
          }}
        >
          Copy CLI command
        </MenuItem>
        <MenuItem component={Link} to="/audit" onClick={() => setMenu(null)}>
          Audit trail
        </MenuItem>
      </Menu>
      {sessions.length === 0 ? (
        <Box sx={{ flex: 1, display: 'grid', placeContent: 'center', minHeight: 0 }}>
          <Typography color="text.secondary" variant="body2" sx={{ maxWidth: 440, textAlign: 'center' }}>
            Select a node and open a tab. Sessions stay connected while you navigate. The shell uses that node’s SSH
            permissions.
          </Typography>
        </Box>
      ) : (
        <>
          <Tabs
            value={active}
            onChange={setActive}
            onClose={(id) => {
              const session = sessions.find((item) => item.id === id);
              if (!session) return;
              setPendingCloseLabel(`${session.nodeName} ${tabNumbers.current.get(id)}`);
              setPendingClose(id);
            }}
            tabs={sessions.map((session) => ({
              value: session.id,
              label: `${session.nodeName} ${tabNumbers.current.get(session.id)}${session.state === 'closed' ? ' · closed' : ''}`,
              closable: true,
              closeDisabled: busy,
              closeLabel: `Close ${session.nodeName} ${tabNumbers.current.get(session.id)}`,
            }))}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            aria-label="SSH sessions"
            sx={{
              minHeight: 36,
              '& .MuiTab-root': {
                minHeight: 36,
                py: 0.5,
                maxWidth: 240,
                minWidth: 80,
                textTransform: 'none',
                fontFamily: 'monospace',
                fontSize: 12,
              },
            }}
          />
          <Box
            data-testid="terminal-grid"
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'grid',
              gap: 1,
              gridTemplateColumns: 'minmax(0, 1fr)',
              gridTemplateRows: second ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
              '@container ssh-workspace (min-width: 960px)': second
                ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'minmax(0, 1fr)' }
                : {},
            }}
          >
            {sessions.map((session) => (
              <TerminalPane
                key={session.id}
                session={session}
                label={`${session.nodeName} ${tabNumbers.current.get(session.id)}`}
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
        <DialogTitle>Close {pendingCloseLabel}?</DialogTitle>
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
  label,
  visible,
  update,
}: {
  session: TerminalSession;
  label: string;
  visible: boolean;
  update: (s: TerminalSession) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const emulator = useRef<Terminal | null>(null);
  const fitter = useRef<FitAddon | null>(null);
  const finder = useRef<SearchAddon | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [paneMenu, setPaneMenu] = useState<HTMLElement | null>(null);
  const theme = useTheme();
  const [readOnly, setReadOnly] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [paste, setPaste] = useState<string | null>(null);
  const [pasteNotice, setPasteNotice] = useState('');
  const { copy } = useCopyToClipboard();

  useEffect(() => {
    if (!host.current) return undefined;
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
    term.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        if (event.type === 'keydown') setSearchOpen(true);
        event.preventDefault();
        return false;
      }
      return true;
    });
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
    let fitFrame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        if (!disposed && element.clientWidth && element.clientHeight) fit.fit();
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(element);
    void document.fonts?.ready.then(scheduleFit);
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
      cancelAnimationFrame(fitFrame);
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
      const frame = requestAnimationFrame(() => {
        fitter.current?.fit();
        emulator.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
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

  useEffect(() => {
    if (emulator.current)
      emulator.current.options.theme = {
        background: theme.palette.background.default,
        foreground: theme.palette.text.primary,
        cursor: theme.palette.primary.main,
        selectionBackground: alpha(theme.palette.primary.main, 0.28),
      };
  }, [theme]);

  return (
    <Card
      variant="outlined"
      data-testid="terminal-pane"
      sx={{
        display: visible ? 'flex' : 'none',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        borderRadius: 1,
        overflow: 'hidden',
        boxShadow: 'none',
        '&:focus-within': { borderColor: 'primary.main' },
      }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          setSearchOpen(true);
        }
      }}
    >
      <Stack
        direction="row"
        spacing={0.5}
        sx={{
          alignItems: 'center',
          px: 1,
          py: 0.5,
          flexShrink: 0,
          minWidth: 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Tooltip title={`${label} · ${session.username}@${session.host}`}>
          <Typography variant="caption" noWrap sx={{ fontFamily: 'monospace', flex: 1, minWidth: 0 }}>
            {label} · {session.username}@{session.host}
          </Typography>
        </Tooltip>
        <Chip
          size="small"
          variant="outlined"
          label={session.state === 'closed' ? (session.reason ?? 'closed') : session.state}
          color={session.state === 'open' ? 'success' : 'default'}
          sx={{ height: 20, maxWidth: 110, fontSize: 10 }}
        />
        <Tooltip title={readOnly ? 'Enable terminal input' : 'Make terminal read only'}>
          <Button
            size="small"
            aria-label={readOnly ? 'Enable terminal input' : 'Make terminal read only'}
            aria-pressed={readOnly}
            color={readOnly ? 'warning' : 'inherit'}
            onClick={() => setReadOnly((v) => !v)}
            sx={{ minWidth: 40, fontFamily: 'monospace', fontSize: 10, px: 0.5 }}
          >
            {readOnly ? 'READ' : 'INPUT'}
          </Button>
        </Tooltip>
        <Tooltip title="Find in scrollback (Ctrl/⌘ Shift F)">
          <IconButton
            size="small"
            aria-label="Find in scrollback"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <SearchIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Terminal actions">
          <IconButton
            size="small"
            aria-label="Terminal actions"
            aria-haspopup="menu"
            onClick={(e) => setPaneMenu(e.currentTarget)}
          >
            <MoreIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Menu anchorEl={paneMenu} open={Boolean(paneMenu)} onClose={() => setPaneMenu(null)}>
        <MenuItem
          onClick={() => {
            void copy(emulator.current?.getSelection() ?? '');
            setPaneMenu(null);
          }}
        >
          Copy selection
        </MenuItem>
        <MenuItem disabled={fontSize <= 10} onClick={() => setFontSize((v) => Math.max(10, v - 1))}>
          Smaller text
        </MenuItem>
        <MenuItem disabled={fontSize >= 24} onClick={() => setFontSize((v) => Math.min(24, v + 1))}>
          Larger text
        </MenuItem>
        <MenuItem
          onClick={() => {
            setFontSize(14);
            setPaneMenu(null);
          }}
        >
          Reset text size · 14 px
        </MenuItem>
      </Menu>
      {error && (
        <Alert severity="error" sx={{ flexShrink: 0, maxHeight: 100, overflow: 'auto', overflowWrap: 'anywhere' }}>
          {error}
        </Alert>
      )}
      {pasteNotice && (
        <Alert severity="warning" onClose={() => setPasteNotice('')} sx={{ flexShrink: 0 }}>
          {pasteNotice}
        </Alert>
      )}
      {searchOpen && (
        <Stack direction="row" spacing={0.5} sx={{ p: 0.75, alignItems: 'center', minWidth: 0, flexShrink: 0 }}>
          <TextField
            size="small"
            autoFocus
            label="Find in scrollback"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) finder.current?.findPrevious(query);
                else finder.current?.findNext(query);
              }
              if (e.key === 'Escape') {
                setSearchOpen(false);
                emulator.current?.focus();
              }
            }}
            sx={{ flex: 1, minWidth: 0 }}
          />
          <IconButton
            size="small"
            aria-label="Previous match"
            disabled={!query}
            onClick={() => finder.current?.findPrevious(query)}
          >
            <ArrowUpIcon />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Next match"
            disabled={!query}
            onClick={() => finder.current?.findNext(query)}
          >
            <ArrowDownIcon />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Close search"
            onClick={() => {
              setSearchOpen(false);
              emulator.current?.focus();
            }}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      )}
      <Box
        ref={host}
        aria-label={`Terminal on ${session.nodeName}`}
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          bgcolor: 'background.default',
          p: 0.75,
          '& .xterm': { height: '100%' },
          '& .xterm-viewport': { overscrollBehavior: 'contain' },
        }}
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
