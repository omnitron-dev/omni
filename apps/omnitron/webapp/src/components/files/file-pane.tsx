import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  IconButton,
  LinearProgress,
  Link,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Tabs } from '@omnitron-dev/prism/components/tabs';
import { TableViewport } from '@omnitron-dev/prism/components/table';
import { AddIcon, MoreIcon, ArrowUpIcon, ArrowLeftIcon, ArrowRightIcon } from '@omnitron-dev/prism/icons';
import { FolderIcon, EditIcon, RefreshIcon } from 'src/assets/icons';
import { files } from 'src/netron/client';
import type { FileEntry, FileLocation, FileRoot } from '@omnitron-dev/omnitron/dto/services';
import {
  describeFileError,
  fileBytes,
  parentPath,
  relativePath,
  visibleEntries,
  type FileHost,
  type PaneSelection,
} from './model';

interface Tab {
  id: string;
  nodeId: string;
  rootId: string;
  path: string;
  history: string[];
  cursor: number;
}
export type FileAction = 'copy' | 'rename' | 'trash' | 'mkdir' | 'create' | 'upload' | 'download' | 'trashList';
export function FilePane({
  side,
  hosts,
  active,
  hidden,
  refreshKey,
  onFocus,
  onSelection,
  onOpen,
  onAction,
}: {
  side: 'left' | 'right';
  hosts: FileHost[];
  active: boolean;
  hidden: boolean;
  refreshKey: number;
  onFocus: () => void;
  onSelection: (value: PaneSelection | null) => void;
  onOpen: (entry: FileEntry, location: FileLocation, readOnly: boolean) => void;
  onAction: (action: FileAction) => void;
}) {
  const initial = useRef<Tab>({
    id: crypto.randomUUID(),
    nodeId: side === 'right' ? (hosts.find((h) => !h.isLocal)?.id ?? 'local') : 'local',
    rootId: '',
    path: '',
    history: [''],
    cursor: 0,
  });
  const [tabs, setTabs] = useState([initial.current]),
    [tabId, setTabId] = useState(initial.current.id);
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0]!;
  const [roots, setRoots] = useState<FileRoot[]>([]),
    [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [next, setNext] = useState<string | null>(null),
    [revision, setRevision] = useState(''),
    [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<'name' | 'size' | 'modifiedAt'>('name'),
    [descending, setDescending] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null),
    [editingPath, setEditingPath] = useState(false),
    [pathInput, setPathInput] = useState('');
  const generation = useRef(0),
    anchor = useRef<string | null>(null),
    region = useRef<HTMLDivElement>(null);
  const root = roots.find((r) => r.id === tab.rootId);
  const location = useMemo(
    () => ({ nodeId: tab.nodeId, rootId: tab.rootId, path: tab.path }),
    [tab.nodeId, tab.rootId, tab.path]
  );
  const selectionCallback = useRef(onSelection);
  selectionCallback.current = onSelection;
  const rows = useMemo(
    () => visibleEntries(entries, query, showHidden, sort, descending),
    [entries, query, showHidden, sort, descending]
  );
  const selection = useMemo(() => rows.filter((e) => selected.includes(e.path)), [rows, selected]);
  const patch = (change: Partial<Tab>) => setTabs((all) => all.map((t) => (t.id === tab.id ? { ...t, ...change } : t)));
  const navigate = (path: string) => {
    patch({
      path,
      history: [...tab.history.slice(0, tab.cursor + 1), path].slice(-100),
      cursor: Math.min(tab.cursor + 1, 99),
    });
    setSelected([]);
    setQuery('');
    setEditingPath(false);
  };
  const travel = (offset: number) => {
    const cursor = tab.cursor + offset;
    if (cursor >= 0 && cursor < tab.history.length) {
      patch({ cursor, path: tab.history[cursor]! });
      setSelected([]);
      setQuery('');
    }
  };
  useEffect(() => {
    let current = true;
    setRoots([]);
    setEntries([]);
    setError('');
    setSelected([]);
    void files
      .roots({ nodeId: tab.nodeId })
      .then((result) => {
        if (!current) return;
        if (result.protocol !== 1) throw new Error('Node requires a compatible file protocol');
        setRoots(result.roots);
        setTabs((all) =>
          all.map((t) =>
            t.id === tab.id && !result.roots.some((r) => r.id === t.rootId)
              ? { ...t, rootId: result.roots[0]?.id ?? '', path: '', history: [''], cursor: 0 }
              : t
          )
        );
      })
      .catch((e) => {
        if (current) setError(describeFileError(e));
      });
    return () => {
      current = false;
    };
  }, [tab.id, tab.nodeId]);
  useEffect(() => {
    const run = ++generation.current;
    setSelected([]);
    setEntries([]);
    setNext(null);
    setError('');
    if (!tab.rootId || !root) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    void files
      .list(location)
      .then((data) => {
        if (run === generation.current) {
          setEntries(data.entries);
          setNext(data.next);
          setRevision(data.revision);
        }
      })
      .catch((e) => {
        if (run === generation.current) setError(describeFileError(e));
      })
      .finally(() => {
        if (run === generation.current) setLoading(false);
      });
    return () => {
      generation.current = run + 1;
    };
  }, [tab.id, tab.rootId, location, root, reload, refreshKey]);
  const more = async () => {
    if (!next || loading) return;
    const run = generation.current;
    setLoading(true);
    try {
      const data = await files.list({ ...location, after: next, revision });
      if (run === generation.current) {
        setEntries((all) => [...all, ...data.entries]);
        setNext(data.next);
      }
    } catch (e) {
      if (run === generation.current) setError(describeFileError(e));
    } finally {
      if (run === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    selectionCallback.current(root && !loading && !error ? { location, root, entries: selection } : null);
  }, [location, root, loading, error, selection]);
  const choose = (entry: FileEntry, range: boolean) => {
    if (range && anchor.current) {
      const start = rows.findIndex((e) => e.path === anchor.current),
        end = rows.indexOf(entry);
      if (start >= 0) {
        setSelected(rows.slice(Math.min(start, end), Math.max(start, end) + 1).map((e) => e.path));
        return;
      }
    }
    anchor.current = entry.path;
    setSelected((all) => (all.includes(entry.path) ? all.filter((p) => p !== entry.path) : [...all, entry.path]));
  };
  const open = (entry: FileEntry) => {
    if (entry.kind === 'directory') navigate(entry.path);
    else if (entry.kind === 'file') onOpen(entry, { ...location, path: entry.path }, Boolean(root?.readOnly));
    else
      setError(
        entry.kind === 'symlink'
          ? 'Symbolic links are visible but cannot be followed'
          : 'Special files cannot be opened'
      );
  };
  const actions: Array<[FileAction, string, boolean]> = [
    ['create', 'New file', !root || Boolean(root.readOnly)],
    ['mkdir', 'New folder', !root || Boolean(root.readOnly)],
    ['upload', 'Upload from this computer', !root || Boolean(root.readOnly)],
    ['copy', 'Copy to other panel · F5', !selection.length],
    ['download', 'Download to this computer', selection.length !== 1 || selection[0]?.kind !== 'file'],
    ['rename', 'Rename · F2', selection.length !== 1 || Boolean(root?.readOnly)],
    ['trash', 'Move to trash · Delete', !selection.length || Boolean(root?.readOnly)],
    ['trashList', 'Restore from trash', !root],
  ];
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-label={`${side} file panel`}
      ref={region}
      onFocusCapture={onFocus}
      onPointerDown={onFocus}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
          e.preventDefault();
          setPathInput('/' + tab.path);
          setEditingPath(true);
        } else if (e.altKey && e.key === 'ArrowLeft') {
          e.preventDefault();
          travel(-1);
        } else if (e.altKey && e.key === 'ArrowRight') {
          e.preventDefault();
          travel(1);
        } else if (e.altKey && e.key === 'ArrowUp') {
          e.preventDefault();
          navigate(parentPath(tab.path));
        } else if (e.key === 'F5' && selection.length) {
          e.preventDefault();
          onAction('copy');
        } else if (e.key === 'F2' && selection.length === 1 && !root?.readOnly) {
          e.preventDefault();
          onAction('rename');
        } else if (e.key === 'F4' && selection.length === 1) {
          e.preventDefault();
          open(selection[0]!);
        } else if (e.key === 'Delete' && selection.length && !root?.readOnly) {
          e.preventDefault();
          onAction('trash');
        }
      }}
      sx={{
        display: hidden ? 'none' : 'flex',
        flex: 1,
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        borderColor: active ? 'primary.main' : 'divider',
        transition: 'border-color 120ms',
        borderRadius: 1.5,
      }}
    >
      <Tabs
        value={tab.id}
        onChange={setTabId}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={`${side} panel locations`}
        tabs={tabs.map((t) => ({
          value: t.id,
          label: t.path.split('/').at(-1) || hosts.find((h) => h.id === t.nodeId)?.name || 'Files',
          closable: tabs.length > 1,
          closeLabel: `Close ${side} location ${t.path || 'root'}`,
        }))}
        onClose={(id) => {
          const rest = tabs.filter((t) => t.id !== id);
          setTabs(rest);
          if (tabId === id) setTabId(rest[0]!.id);
        }}
        action={
          <Tooltip title="New location tab">
            <span>
              <IconButton
                aria-label={`New ${side} location tab`}
                size="small"
                disabled={tabs.length >= 8}
                onClick={() => {
                  const copy = { ...tab, id: crypto.randomUUID() };
                  setTabs((all) => [...all, copy]);
                  setTabId(copy.id);
                }}
              >
                <AddIcon />
              </IconButton>
            </span>
          </Tooltip>
        }
        sx={{ px: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 72, maxWidth: 180, fontSize: 12 } }}
      />
      <Stack direction="row" spacing={1} sx={{ p: 1, minWidth: 0 }}>
        <TextField
          select
          size="small"
          label="Node"
          value={tab.nodeId}
          onChange={(e) => patch({ nodeId: e.target.value, rootId: '', path: '', history: [''], cursor: 0 })}
          sx={{ flex: 1, minWidth: 0 }}
        >
          {hosts.map((h) => (
            <MenuItem key={h.id} value={h.id}>
              {h.name}
              {h.isLocal ? ' · daemon' : ''}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Root"
          value={root?.id ?? ''}
          onChange={(e) => patch({ rootId: e.target.value, path: '', history: [''], cursor: 0 })}
          sx={{ flex: 1, minWidth: 0 }}
          disabled={!roots.length}
        >
          {roots.map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.label}
              {r.readOnly ? ' · read only' : ''}
            </MenuItem>
          ))}
        </TextField>
        <IconButton aria-label={`${side} panel actions`} onClick={(e) => setMenu(e.currentTarget)}>
          <MoreIcon />
        </IconButton>
      </Stack>
      <Stack direction="row" spacing={0.25} sx={{ px: 1, alignItems: 'center', minHeight: 36, minWidth: 0 }}>
        <Tooltip title="Back · Alt+←">
          <span>
            <IconButton
              size="small"
              aria-label={`Back in ${side} panel`}
              disabled={tab.cursor === 0}
              onClick={() => travel(-1)}
            >
              <ArrowLeftIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Forward · Alt+→">
          <span>
            <IconButton
              size="small"
              aria-label={`Forward in ${side} panel`}
              disabled={tab.cursor >= tab.history.length - 1}
              onClick={() => travel(1)}
            >
              <ArrowRightIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Parent folder · Alt+↑">
          <span>
            <IconButton
              size="small"
              aria-label={`Parent of ${side} panel`}
              disabled={!tab.path}
              onClick={() => navigate(parentPath(tab.path))}
            >
              <ArrowUpIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0, px: 0.5, overflow: 'hidden' }}>
          {editingPath ? (
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Path within root"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingPath(false);
                if (e.key === 'Enter') {
                  try {
                    navigate(relativePath(pathInput));
                  } catch (err) {
                    setError(describeFileError(err));
                  }
                }
              }}
            />
          ) : (
            <Breadcrumbs
              aria-label={`${side} path`}
              maxItems={3}
              sx={{
                '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' },
                '& .MuiBreadcrumbs-li': { minWidth: 0 },
                '& button': {
                  maxWidth: 170,
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                  fontSize: 12,
                },
              }}
            >
              <Link component="button" underline="hover" onClick={() => navigate('')}>
                /
              </Link>
              {tab.path
                .split('/')
                .filter(Boolean)
                .map((part, i) => (
                  <Link
                    key={i}
                    component="button"
                    underline="hover"
                    onClick={() =>
                      navigate(
                        tab.path
                          .split('/')
                          .slice(0, i + 1)
                          .join('/')
                      )
                    }
                  >
                    {part}
                  </Link>
                ))}
            </Breadcrumbs>
          )}
        </Box>
        <Tooltip title="Edit path · Ctrl/⌘+L">
          <IconButton
            size="small"
            aria-label={`Edit ${side} path`}
            onClick={() => {
              setPathInput('/' + tab.path);
              setEditingPath(true);
            }}
          >
            <EditIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Refresh">
          <IconButton size="small" aria-label={`Refresh ${side} panel`} onClick={() => setReload((n) => n + 1)}>
            <RefreshIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <TextField
        size="small"
        placeholder="Filter loaded entries…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected([]);
        }}
        slotProps={{ htmlInput: { 'aria-label': `Filter ${side} files` } }}
        sx={{ mx: 1, my: 0.75 }}
      />
      <Box sx={{ height: 2, flexShrink: 0 }}>{loading && <LinearProgress aria-label={`Loading ${side} files`} />}</Box>
      {error && (
        <Alert severity="error" sx={{ mx: 1, my: 0.5, overflowWrap: 'anywhere' }}>
          {error}
        </Alert>
      )}
      {!roots.length && !error && (
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            No file roots exported. Configure daemon.files.roots on this node to enable access.
          </Typography>
        </Box>
      )}
      <TableViewport label={`${side} directory entries`} sx={{ flex: 1, minHeight: 100 }}>
        <Table
          size="small"
          stickyHeader
          aria-label={`${side} files`}
          sx={{
            tableLayout: 'fixed',
            '& td, & th': { px: 1, py: 0.6 },
            '& td:first-of-type, & th:first-of-type': { px: 0 },
            '& .MuiCheckbox-root': { p: 0.75 },
            '& .MuiTableRow-root:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.main',
              outlineOffset: -2,
            },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ width: 40 }}>
                <Checkbox
                  size="small"
                  slotProps={{ input: { 'aria-label': `Select loaded ${side} entries` } }}
                  checked={rows.length > 0 && selection.length === rows.length}
                  indeterminate={selection.length > 0 && selection.length < rows.length}
                  onChange={(_, checked) => setSelected(checked ? rows.map((e) => e.path) : [])}
                />
              </TableCell>
              {(['name', 'size', 'modifiedAt'] as const).map((key) => (
                <TableCell
                  key={key}
                  sx={
                    key === 'name'
                      ? {}
                      : key === 'size'
                        ? { width: 80 }
                        : { width: 110, display: { xs: 'none', lg: 'table-cell' } }
                  }
                >
                  <TableSortLabel
                    active={sort === key}
                    direction={descending ? 'desc' : 'asc'}
                    onClick={() => {
                      if (sort === key) setDescending((v) => !v);
                      else {
                        setSort(key);
                        setDescending(false);
                      }
                    }}
                  >
                    {key === 'modifiedAt' ? 'Modified' : key === 'name' ? 'Name' : 'Size'}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((entry, i) => (
              <TableRow
                key={entry.path}
                hover
                selected={selected.includes(entry.path)}
                tabIndex={0}
                aria-label={`${entry.kind} ${entry.name}`}
                onClick={(e) => choose(entry, e.shiftKey)}
                onDoubleClick={() => open(entry)}
                onKeyDown={(e) => {
                  if ((e.target as HTMLElement).closest('input,button')) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    open(entry);
                  }
                  if (e.key === ' ') {
                    e.preventDefault();
                    choose(entry, e.shiftKey);
                  }
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const offset = e.key === 'ArrowDown' ? 1 : -1;
                    const target = e.currentTarget.parentElement?.children[i + offset] as HTMLElement | undefined;
                    target?.focus();
                  }
                }}
              >
                <TableCell>
                  <Checkbox
                    size="small"
                    checked={selected.includes(entry.path)}
                    slotProps={{ input: { 'aria-label': `Select ${entry.name}` } }}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => choose(entry, false)}
                  />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                    {entry.kind === 'directory' ? (
                      <FolderIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
                    ) : (
                      <Typography
                        component="span"
                        aria-hidden
                        sx={{ fontFamily: 'monospace', fontSize: 11, color: 'text.disabled', flexShrink: 0 }}
                      >
                        {entry.kind === 'file' ? '┄' : '↗'}
                      </Typography>
                    )}
                    <Tooltip title={entry.name}>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(entry);
                        }}
                        sx={{
                          minWidth: 0,
                          justifyContent: 'flex-start',
                          textTransform: 'none',
                          fontWeight: entry.kind === 'directory' ? 600 : 400,
                          overflow: 'hidden',
                          p: 0,
                          fontSize: 13,
                        }}
                      >
                        <Box
                          component="span"
                          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {entry.name}
                        </Box>
                      </Button>
                    </Tooltip>
                  </Stack>
                </TableCell>
                <TableCell
                  sx={{ color: 'text.secondary', fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap' }}
                >
                  {entry.kind === 'file' ? fileBytes(entry.size) : entry.kind === 'directory' ? '—' : entry.kind}
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, color: 'text.secondary', fontSize: 11 }}>
                  <Tooltip title={new Date(entry.modifiedAt).toLocaleString()}>
                    <span>
                      {new Date(entry.modifiedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!loading && root && !rows.length && !error && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            {query ? 'No matches in loaded entries' : 'Empty folder'}
          </Typography>
        )}
        {next && (
          <Button fullWidth onClick={() => void more()} disabled={loading}>
            Load next 200 entries
          </Button>
        )}
      </TableViewport>
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 0.75, alignItems: 'center', borderTop: 1, borderColor: 'divider', minWidth: 0 }}
      >
        <Typography variant="caption" color="text.secondary" aria-live="polite" sx={{ flex: 1 }}>
          {selection.length
            ? `${selection.length} selected · ${fileBytes(selection.reduce((n, e) => n + (e.kind === 'file' ? e.size : 0), 0))}`
            : `${rows.length}${next ? '+' : ''} entries`}
        </Typography>
        {root?.readOnly && <Chip size="small" variant="outlined" label="Read only" />}
        <Typography
          variant="caption"
          color={active ? 'primary.main' : 'text.disabled'}
          sx={{ textTransform: 'uppercase', letterSpacing: 1.5 }}
        >
          {side === 'left' ? 'A' : 'B'}
        </Typography>
      </Stack>
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {actions.map(([key, label, disabled]) => (
          <MenuItem
            key={key}
            disabled={disabled || loading}
            onClick={() => {
              setMenu(null);
              onAction(key);
            }}
          >
            {label}
          </MenuItem>
        ))}
        <MenuItem
          onClick={() => {
            setShowHidden((v) => !v);
            setSelected([]);
            setMenu(null);
          }}
        >
          {showHidden ? 'Hide' : 'Show'} hidden entries
        </MenuItem>
      </Menu>
    </Paper>
  );
}
