import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  ListItemText,
  ListSubheader,
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
import { AddIcon, MoreIcon, ArrowLeftIcon, ArrowRightIcon } from '@omnitron-dev/prism/icons';
import { FolderIcon, EditIcon, RefreshIcon, ParentFolderIcon } from 'src/assets/icons';
import { useFileDirectory } from './use-file-directory';
import { useConsoleActions } from 'src/components/console-keyboard';
import type { FileEntry, FileLocation } from '@omnitron-dev/omnitron/dto/services';
import { fileStructureError } from '@omnitron-dev/omnitron/dto/services';
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
  readonly nodeId: string;
  rootId: string;
  rootLabel?: string;
  path: string;
  history: string[];
  cursor: number;
}
function newLocation(nodeId: string): Tab {
  return { id: crypto.randomUUID(), nodeId, rootId: '', path: '', history: [''], cursor: 0 };
}
type ParentRow = { name: '..'; path: string; kind: 'parent' };
export type FileAction = 'copy' | 'rename' | 'trash' | 'mkdir' | 'create' | 'upload' | 'download' | 'trashList';
export function FilePane({
  side,
  hosts,
  discovery,
  retryDiscovery,
  active,
  hidden,
  refreshKey,
  onFocus,
  onSelection,
  onOpen,
  onAction,
  onSwitchPanel,
  visible = true,
}: {
  side: 'left' | 'right';
  hosts: FileHost[];
  discovery: { pending: boolean; error?: string };
  retryDiscovery: () => void;
  active: boolean;
  hidden: boolean;
  refreshKey: number;
  onFocus: () => void;
  onSelection: (value: PaneSelection | null) => void;
  onOpen: (entry: FileEntry, location: FileLocation, readOnly: boolean) => void;
  onAction: (action: FileAction) => void;
  onSwitchPanel: () => void;
  visible?: boolean;
}) {
  const [tabs, setTabs] = useState(() => [newLocation('local')]);
  const [tabId, setTabId] = useState(tabs[0]!.id);
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0]!;
  const [chooser, setChooser] = useState<HTMLElement | null>(null);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [toolsMode, setToolsMode] = useState(false);
  const pointerEntry = useRef(false);
  const listing = useRef<HTMLTableElement>(null);
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<'name' | 'size' | 'modifiedAt'>('name'),
    [descending, setDescending] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null),
    [editingPath, setEditingPath] = useState(false),
    [pathInput, setPathInput] = useState('');
  const anchor = useRef<string | null>(null),
    region = useRef<HTMLDivElement>(null);
  const location = useMemo(
    () => ({ nodeId: tab.nodeId, rootId: tab.rootId, path: tab.path }),
    [tab.nodeId, tab.rootId, tab.path]
  );
  const {
    policy,
    root,
    entries,
    next,
    more,
    ready,
    loading,
    error: readError,
  } = useFileDirectory(tab.id, location, reload, refreshKey);
  const error = readError || notice;
  const single = policy?.roots.length === 1 ? policy.roots[0] : undefined;
  useEffect(() => {
    if (tab.rootId || !single) return;
    setTabs((all) =>
      all.map((t) => (t.id === tab.id && !t.rootId ? { ...t, rootId: single.id, rootLabel: single.label } : t))
    );
  }, [single, tab.id, tab.rootId]);
  const switchTab = (id: string) => {
    setTabId(id);
    setSelected([]);
    setCursor(null);
    anchor.current = null;
    setQuery('');
    setEditingPath(false);
    setNotice('');
  };
  const hostName = (nodeId: string) => hosts.find((host) => host.id === nodeId)?.name ?? nodeId;
  const tabLabel = (t: Tab) =>
    [hostName(t.nodeId), t.path.split('/').at(-1) || (t.rootLabel !== 'Filesystem' ? t.rootLabel : '')]
      .filter(Boolean)
      .join(' · ');
  const selectionCallback = useRef(onSelection);
  selectionCallback.current = onSelection;
  const rows = useMemo(
    () => visibleEntries(entries, query, showHidden, sort, descending),
    [entries, query, showHidden, sort, descending]
  );
  const navigationRows: Array<FileEntry | ParentRow> =
    ready && tab.path ? [{ name: '..', path: parentPath(tab.path), kind: 'parent' }, ...rows] : rows;
  const currentPath = navigationRows.some((row) => row.path === cursor) ? cursor : (navigationRows[0]?.path ?? null);
  const marked = useMemo(() => rows.filter((e) => selected.includes(e.path)), [rows, selected]);
  const selection = useMemo(
    () => (marked.length ? marked : rows.filter((e) => e.path === currentPath)),
    [rows, marked, currentPath]
  );
  const focusRow = (index: number, range = false) => {
    const row = navigationRows[Math.max(0, Math.min(navigationRows.length - 1, index))];
    if (!row) return;
    if (range) {
      anchor.current ??= currentPath;
      const start = navigationRows.findIndex((entry) => entry.path === anchor.current),
        end = navigationRows.indexOf(row);
      setSelected(
        navigationRows
          .slice(Math.min(Math.max(0, start), end), Math.max(start, end) + 1)
          .filter((entry) => entry.kind !== 'parent')
          .map((entry) => entry.path)
      );
    } else anchor.current = row.path;
    setCursor(row.path);
    const element = listing.current?.querySelectorAll<HTMLElement>('tbody > tr')[navigationRows.indexOf(row)];
    element?.focus({ preventScroll: true });
    element?.scrollIntoView?.({ block: 'nearest' });
  };
  const patch = (change: Partial<Omit<Tab, 'id' | 'nodeId'>>) =>
    setTabs((all) => all.map((t) => (t.id === tab.id ? { ...t, ...change } : t)));
  const navigate = (path: string) => {
    if (!root) return;
    setNotice('');
    patch({
      path,
      history: [...tab.history.slice(0, tab.cursor + 1), path].slice(-100),
      cursor: Math.min(tab.cursor + 1, 99),
    });
    setSelected([]);
    setCursor(null);
    setQuery('');
    setEditingPath(false);
    requestAnimationFrame(() => listing.current?.focus({ preventScroll: true }));
  };
  const travel = (offset: number) => {
    if (!root) return;
    const historyIndex = tab.cursor + offset;
    if (historyIndex >= 0 && historyIndex < tab.history.length) {
      setNotice('');
      patch({ cursor: historyIndex, path: tab.history[historyIndex]! });
      setSelected([]);
      setCursor(null);
      setQuery('');
    }
  };
  useEffect(() => {
    const keyboard = () => {
      pointerEntry.current = false;
    };
    window.addEventListener('keydown', keyboard, true);
    return () => window.removeEventListener('keydown', keyboard, true);
  }, []);
  useLayoutEffect(() => {
    selectionCallback.current(root && ready && !error ? { location, root, entries: selection } : null);
  }, [location, root, ready, error, selection]);
  const choose = (entry: FileEntry, range: boolean) => {
    setCursor(entry.path);
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
  const open = (entry: FileEntry | ParentRow) => {
    if (!root || !ready) return;
    if (entry.kind === 'directory' || entry.kind === 'parent') navigate(entry.path);
    else if (entry.kind === 'file') onOpen(entry, { ...location, path: entry.path }, Boolean(root?.readOnly));
    else
      setNotice(
        entry.kind === 'symlink'
          ? 'Symbolic links are visible but cannot be followed'
          : 'Special files cannot be opened'
      );
  };
  const protectedSelection = selection.some((entry) => fileStructureError(entry.path, root?.protectedPaths));
  const actions: Array<[FileAction, string, boolean]> = [
    ['create', 'New file', !root || Boolean(root.readOnly)],
    ['mkdir', 'New folder', !root || Boolean(root.readOnly)],
    ['upload', 'Upload from this computer', !root || Boolean(root.readOnly)],
    ['copy', 'Copy to other panel · F5', !selection.length],
    ['download', 'Download to this computer', selection.length !== 1 || selection[0]?.kind !== 'file'],
    ['rename', 'Rename · F2', selection.length !== 1 || Boolean(root?.readOnly) || protectedSelection],
    ['trash', 'Move to trash · Delete', !selection.length || Boolean(root?.readOnly) || protectedSelection],
    ['trashList', 'Restore from trash', !root],
  ];
  useConsoleActions(
    [
      {
        id: 'files-rename',
        title: 'Rename file',
        group: 'Files',
        key: 'F2',
        shortcut: ['F2'],
        disabled: selection.length !== 1 || Boolean(root?.readOnly) || protectedSelection || loading,
        onSelect: () => onAction('rename'),
      },
      {
        id: 'files-edit',
        title: 'Open selected file',
        group: 'Files',
        key: 'F4',
        shortcut: ['F4'],
        disabled: selection.length !== 1 || loading,
        onSelect: () => open(selection[0]!),
      },
      {
        id: 'files-copy',
        title: 'Copy to other panel',
        group: 'Files',
        key: 'F5',
        shortcut: ['F5'],
        disabled: !selection.length || loading,
        onSelect: () => onAction('copy'),
      },
      {
        id: 'files-trash',
        title: 'Move selection to trash…',
        group: 'Files',
        key: 'Delete',
        shortcut: ['Delete'],
        disabled: !selection.length || Boolean(root?.readOnly) || protectedSelection || loading,
        onSelect: () => onAction('trash'),
      },
    ],
    visible && active && !hidden,
    region
  );
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-label={`${side} file panel`}
      ref={region}
      data-file-side={side}
      data-keyboard-region={`Files ${side === 'left' ? 'A' : 'B'}`}
      aria-description="Tab switches panels. Escape switches between the list and tools. F6 moves to another Console region."
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.target) || !visible || hidden) return;
        onFocus();
        // The same composite entry point for sidebar Tab, F6, restoration and programmatic focus.
        // A pointer intentionally selecting a field keeps native field behavior.
        if (
          !event.currentTarget.contains(event.relatedTarget as Node | null) &&
          !pointerEntry.current &&
          !toolsMode &&
          event.target !== listing.current &&
          !(event.target as HTMLElement).closest('tbody')
        ) {
          (listing.current ?? region.current?.querySelector<HTMLElement>('[data-file-start]'))?.focus({
            preventScroll: true,
          });
        }
        if (event.target === listing.current || (event.target as HTMLElement).closest('tbody')) setToolsMode(false);
      }}
      onBlurCapture={(event) => {
        const nextFocus = event.relatedTarget as HTMLElement | null;
        if (
          !event.currentTarget.contains(nextFocus) &&
          !nextFocus?.closest('[role="dialog"],[role="menu"],[role="listbox"]')
        )
          setToolsMode(false);
      }}
      onPointerDownCapture={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        pointerEntry.current = true;
        const inList = Boolean((event.target as HTMLElement).closest('[data-file-list]'));
        setToolsMode(!inList);
        onFocus();
        if (!(event.target as HTMLElement).closest('input,button,a,[role="combobox"],tbody tr'))
          listing.current?.focus({ preventScroll: true });
      }}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.nativeEvent.isComposing || !visible || hidden) return;
        const target = e.target as HTMLElement;
        if (target.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
        const inList = Boolean(target.closest('[data-file-list]'));
        if (inList && !toolsMode && e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          onSwitchPanel();
          return;
        }
        if (e.key === 'Escape' && !editingPath) {
          e.preventDefault();
          e.stopPropagation();
          setSelected([]);
          if (inList && !toolsMode) {
            setToolsMode(true);
            (
              region.current?.querySelector<HTMLElement>('[data-file-add]:not(:disabled)') ??
              region.current?.querySelector<HTMLElement>('[data-file-tools] button:not(:disabled)')
            )?.focus();
          } else {
            setToolsMode(false);
            listing.current?.focus({ preventScroll: true });
          }
          return;
        }
        if (target.closest('input:not([type="checkbox"]),textarea,select,[contenteditable="true"]')) return;
        if (inList && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          setSelected(rows.map((entry) => entry.path));
          return;
        }
        if (inList && !target.closest('input,button,a') && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const index = navigationRows.findIndex((row) => row.path === currentPath);
          const page = Math.max(1, Math.floor((listing.current?.parentElement?.clientHeight || 400) / 40));
          const positions: Record<string, number> = {
            ArrowDown: index + 1,
            ArrowUp: index - 1,
            Home: 0,
            End: navigationRows.length - 1,
            PageDown: index + page,
            PageUp: index - page,
          };
          if (e.key in positions) {
            e.preventDefault();
            focusRow(positions[e.key]!, e.shiftKey);
            return;
          }
          const entry = navigationRows[index];
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            if (e.key === 'ArrowLeft' && tab.path) navigate(parentPath(tab.path));
            if (e.key === 'ArrowRight' && entry?.kind === 'directory') open(entry);
            return;
          }
          if (entry && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            if (e.key === 'Enter') open(entry);
            else if (entry.kind !== 'parent') choose(entry, e.shiftKey);
            return;
          }
        }
        if (root && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
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
        }
      }}
      sx={{
        display: hidden ? 'none' : 'flex',
        flex: 1,
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        borderColor: 'divider',
        '&:focus-within': { borderColor: 'primary.main' },
        transition: 'border-color 120ms',
        borderRadius: 1.5,
      }}
    >
      <Tabs
        value={tab.id}
        onChange={switchTab}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={`${side} panel locations`}
        tabs={tabs.map((t) => ({
          value: t.id,
          label: tabLabel(t),
          closable: tabs.length > 1,
          closeLabel: `Close ${side} location ${tabLabel(t)}`,
        }))}
        onClose={(id) => {
          const rest = tabs.filter((t) => t.id !== id);
          if (!rest.length) return;
          setTabs(rest);
          if (tabId === id)
            switchTab(
              rest[
                Math.min(
                  tabs.findIndex((t) => t.id === id),
                  rest.length - 1
                )
              ]!.id
            );
        }}
        action={
          <Tooltip title={tabs.length >= 8 ? 'Close a tab to open another (8 per panel)' : 'Open a node in a new tab'}>
            <span>
              <IconButton
                aria-label={`New ${side} location tab`}
                size="small"
                disabled={tabs.length >= 8}
                data-file-add
                aria-haspopup="menu"
                aria-expanded={Boolean(chooser)}
                aria-controls={chooser ? `choose-${side}-file-node` : undefined}
                onClick={(event) => setChooser(event.currentTarget)}
              >
                <AddIcon />
              </IconButton>
            </span>
          </Tooltip>
        }
        sx={{ px: 1, minHeight: 40, '& .MuiTab-root': { minHeight: 40, minWidth: 72, maxWidth: 180, fontSize: 12 } }}
      />
      <Menu
        id={`choose-${side}-file-node`}
        anchorEl={chooser}
        open={Boolean(chooser)}
        onClose={() => setChooser(null)}
        slotProps={{
          list: { 'aria-label': 'Choose a node' },
          paper: { sx: { minWidth: 208, maxWidth: 'min(360px, 92vw)' } },
        }}
      >
        <ListSubheader>Choose a node</ListSubheader>
        {hosts.map((host) => (
          <MenuItem
            key={host.id}
            onClick={() => {
              const added = newLocation(host.id);
              setTabs((all) => [...all, added]);
              switchTab(added.id);
              setChooser(null);
            }}
          >
            <ListItemText
              primary={host.name}
              secondary={host.isLocal ? 'This daemon' : host.host}
              sx={{ overflowWrap: 'anywhere' }}
            />
          </MenuItem>
        ))}
        {discovery.pending && <MenuItem disabled>Loading registered nodes…</MenuItem>}
        {discovery.error && (
          <MenuItem onClick={retryDiscovery}>
            <ListItemText
              primary="Retry loading remote nodes"
              secondary={discovery.error}
              sx={{ overflowWrap: 'anywhere' }}
            />
          </MenuItem>
        )}
      </Menu>
      <Stack
        data-file-tools
        direction="row"
        spacing={0.25}
        sx={{ px: 1, alignItems: 'center', minHeight: 36, minWidth: 0 }}
      >
        <Tooltip title="Back · Alt+←">
          <span>
            <IconButton
              size="small"
              aria-label={`Back in ${side} panel`}
              disabled={!root || tab.cursor === 0}
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
              disabled={!root || tab.cursor >= tab.history.length - 1}
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
              disabled={!root || !tab.path}
              onClick={() => navigate(parentPath(tab.path))}
            >
              <ParentFolderIcon fontSize="small" />
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
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingPath(false);
                  requestAnimationFrame(() => listing.current?.focus({ preventScroll: true }));
                }
                if (e.key === 'Enter') {
                  try {
                    navigate(relativePath(pathInput));
                  } catch (err) {
                    setNotice(describeFileError(err));
                  }
                }
              }}
            />
          ) : root ? (
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
                {root.id === 'system' && root.label === 'Filesystem' ? '/' : root.label}
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
          ) : null}
        </Box>
        {root && (
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
        )}
        <Tooltip title="Refresh">
          <IconButton
            data-file-retry
            size="small"
            aria-label={`Refresh ${side} panel`}
            onClick={() => {
              setNotice('');
              setReload((n) => n + 1);
            }}
          >
            <RefreshIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Panel actions">
          <IconButton size="small" aria-label={`${side} panel actions`} onClick={(e) => setMenu(e.currentTarget)}>
            <MoreIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {root && (
        <TextField
          size="small"
          placeholder="Filter loaded entries…"
          data-console-command="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected([]);
          }}
          slotProps={{ htmlInput: { 'aria-label': `Filter ${side} files` } }}
          sx={{ mx: 1, my: 0.75 }}
        />
      )}
      <Box sx={{ height: 2, flexShrink: 0 }}>{loading && <LinearProgress aria-label={`Loading ${side} files`} />}</Box>
      {error && (
        <Alert severity="error" sx={{ m: 1, overflowWrap: 'anywhere' }}>
          {error}
        </Alert>
      )}
      {!root && (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {policy &&
            !policy.error &&
            (tab.rootId ? (
              <Alert severity="warning" sx={{ m: 1 }}>
                This file area is no longer available. Refresh or open a new tab.
              </Alert>
            ) : !policy.roots.length ? (
              <Alert severity="info" sx={{ m: 1 }}>
                No file areas are available on this node. Check its file access policy.
              </Alert>
            ) : policy.roots.length > 1 ? (
              <Stack role="group" aria-label="Choose a file area" spacing={0.5} sx={{ p: 1.5 }}>
                <Typography variant="subtitle2">Choose a file area</Typography>
                {policy.roots.map((area, index) => (
                  <Button
                    data-file-start={index === 0 ? true : undefined}
                    key={area.id}
                    variant="text"
                    aria-label={`Open ${area.label}`}
                    onClick={() => patch({ rootId: area.id, rootLabel: area.label })}
                    sx={{ justifyContent: 'flex-start', gap: 1 }}
                  >
                    <FolderIcon fontSize="small" /> {area.label}
                    {area.readOnly && (
                      <Typography variant="caption" color="text.secondary">
                        Read only
                      </Typography>
                    )}
                  </Button>
                ))}
              </Stack>
            ) : null)}
        </Box>
      )}
      {root && (
        <TableViewport
          keyboardNavigation={false}
          tabIndex={-1}
          label={`${side} directory entries`}
          sx={{ flex: 1, minHeight: 100 }}
        >
          <Table
            ref={listing}
            tabIndex={active && !toolsMode ? 0 : -1}
            data-keyboard-focus
            data-file-list
            size="small"
            stickyHeader
            aria-label={`${side} files`}
            sx={{
              tableLayout: 'fixed',
              '& td, & th': { px: 1, py: 0.6 },
              '& td:first-of-type, & th:first-of-type': { px: 0 },
              '& .MuiCheckbox-root': { p: 0.75 },
              '& .MuiTableRow-root[data-cursor="true"]': { bgcolor: 'action.hover' },
              '&:focus-visible': {
                outline: currentPath === null ? '2px solid' : 'none',
                outlineColor: 'primary.main',
                outlineOffset: -2,
              },
              '& .MuiTableRow-root:focus-visible, &:focus-visible .MuiTableRow-root[data-cursor="true"]': {
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
                    checked={rows.length > 0 && marked.length === rows.length}
                    indeterminate={marked.length > 0 && marked.length < rows.length}
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
              {ready && tab.path && (
                <TableRow
                  tabIndex={-1}
                  data-cursor={(active && currentPath === parentPath(tab.path)) || undefined}
                  aria-label="Parent directory"
                  onFocus={() => setCursor(parentPath(tab.path))}
                  onClick={(event) => {
                    setCursor(parentPath(tab.path));
                    event.currentTarget.focus();
                  }}
                  onDoubleClick={() => navigate(parentPath(tab.path))}
                >
                  <TableCell />
                  <TableCell>
                    <Button
                      color="inherit"
                      size="small"
                      tabIndex={-1}
                      aria-label="Open parent directory"
                      onClick={(event) => {
                        event.stopPropagation();
                        navigate(parentPath(tab.path));
                      }}
                      startIcon={<ParentFolderIcon fontSize="small" />}
                      sx={{ minWidth: 0, p: 0, fontFamily: 'monospace' }}
                    >
                      ..
                    </Button>
                  </TableCell>
                  <TableCell />
                  <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }} />
                </TableRow>
              )}
              {rows.map((entry) => (
                <TableRow
                  key={entry.path}
                  hover
                  selected={selected.includes(entry.path)}
                  tabIndex={-1}
                  data-cursor={(active && entry.path === currentPath) || undefined}
                  onFocus={() => setCursor(entry.path)}
                  aria-current={active && entry.path === currentPath ? 'true' : undefined}
                  aria-label={`${entry.kind} ${entry.name}`}
                  onClick={(e) => {
                    choose(entry, e.shiftKey);
                    e.currentTarget.focus({ preventScroll: true });
                  }}
                  onDoubleClick={() => open(entry)}
                >
                  <TableCell>
                    <Checkbox
                      size="small"
                      checked={selected.includes(entry.path)}
                      slotProps={{ input: { 'aria-label': `Select ${entry.name}`, tabIndex: -1 } }}
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
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.currentTarget.closest<HTMLElement>('tr')?.focus({ preventScroll: true });
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
          {ready && !loading && !rows.length && !error && (
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
      )}
      <Stack
        direction="row"
        spacing={1}
        sx={{ px: 1.5, py: 0.75, alignItems: 'center', borderTop: 1, borderColor: 'divider', minWidth: 0 }}
      >
        <Typography variant="caption" color="text.secondary" aria-live="polite" sx={{ flex: 1 }}>
          {marked.length
            ? `${marked.length} selected${marked.every((entry) => entry.kind === 'file') ? ` · ${fileBytes(marked.reduce((n, e) => n + e.size, 0))}` : ''}`
            : !ready
              ? '—'
              : `${rows.length}${next ? '+' : ''} ${rows.length === 1 && !next ? 'entry' : 'entries'}`}
        </Typography>
        {root?.readOnly && <Chip size="small" variant="outlined" label="Read only" />}
        {protectedSelection && (
          <Tooltip title="This structural entry cannot be renamed or moved to trash; its ordinary children remain usable">
            <Chip size="small" variant="outlined" label="Protected" />
          </Tooltip>
        )}
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
            disabled={disabled || !ready || loading}
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
