import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';
import { DashboardWidget } from 'src/components/dashboard-panels';
import { OperationStatus } from 'src/components/operation-status';
import { useDashboardSources } from 'src/hooks/use-dashboard-sources';
import { EditIcon, MoreVertIcon, PlusIcon, RefreshIcon } from 'src/assets/icons';
import { readStored, writeStored } from 'src/utils/storage';
import { METRIC_WINDOWS, type MetricWindow } from 'src/utils/metric-series';
import {
  LAYOUT_KEY,
  PANEL_TYPES,
  PANEL_SIZES,
  STAT_METRICS,
  REFRESH_INTERVALS,
  blankBoard,
  dashboardId,
  defaultBoard,
  exportBoard,
  importBoard,
  parseBoards,
  type DashboardConfig,
  type DashboardPanel,
  type StatMetric,
  type PanelType,
  type Size,
} from 'src/utils/dashboard-layout';

const ACTIVE_KEY = 'omnitron_dashboard_active';
const GRID = {
  small: { xs: 12, sm: 6, lg: 3 },
  medium: { xs: 12, sm: 6, lg: 4 },
  large: { xs: 12, md: 6 },
  full: { xs: 12 },
};
const newPanel = (): DashboardPanel => ({
  id: dashboardId(),
  type: 'stat',
  size: 'small',
  title: '',
  config: { metric: 'online_apps' },
});
type BoardDialog = 'create' | 'settings' | 'duplicate' | 'delete' | 'import' | 'export';
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function initialLayouts() {
  const raw = readStored(LAYOUT_KEY);
  try {
    return { raw, boards: raw ? parseBoards(raw) : [defaultBoard()], error: null };
  } catch (err) {
    return {
      raw,
      boards: [defaultBoard()],
      error: `Saved layouts could not be read. The original is preserved. ${message(err)}`,
    };
  }
}

function PanelEditor({
  panel,
  edit,
  apps,
  onSave,
  onClose,
}: {
  panel: DashboardPanel;
  edit: boolean;
  apps: string[];
  onSave(p: DashboardPanel): void;
  onClose(): void;
}) {
  const [type, setType] = useState<PanelType>(panel.type);
  const [title, setTitle] = useState(panel.title);
  const [size, setSize] = useState<Size>(panel.size);
  const [metric, setMetric] = useState<StatMetric>(panel.config.metric ?? 'online_apps');
  const [app, setApp] = useState(panel.config.app ?? '');
  const scoped = type !== 'daemon-info' && type !== 'alert-summary' && !(type === 'stat' && metric === 'uptime');
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: panel.id,
            type,
            size,
            title: title.trim() || (type === 'stat' ? STAT_METRICS[metric] : PANEL_TYPES[type]),
            config: { ...(type === 'stat' && { metric }), ...(scoped && app.trim() && { app: app.trim() }) },
          });
        }}
      >
        <DialogTitle>{edit ? 'Edit panel' : 'Add panel'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              select
              size="small"
              label="Source"
              value={type}
              onChange={(e) => {
                const t = e.target.value as PanelType;
                setType(t);
                if (!edit) setSize(t === 'stat' ? 'small' : 'large');
              }}
            >
              {Object.entries(PANEL_TYPES).map(([key, value]) => (
                <MenuItem key={key} value={key}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
            {type === 'stat' && (
              <TextField
                select
                size="small"
                label="Metric"
                value={metric}
                onChange={(e) => setMetric(e.target.value as StatMetric)}
              >
                {Object.entries(STAT_METRICS).map(([key, value]) => (
                  <MenuItem key={key} value={key}>
                    {value}
                  </MenuItem>
                ))}
              </TextField>
            )}
            {scoped && (
              <>
                <TextField
                  size="small"
                  label="Application"
                  placeholder="All applications in this scope"
                  value={app}
                  onChange={(e) => setApp(e.target.value)}
                  slotProps={{ htmlInput: { list: 'dashboard-app-names', maxLength: 256 } }}
                  helperText="An exact application name follows the selected workspace and stack."
                />
                <datalist id="dashboard-app-names">
                  {apps.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            )}
            <TextField
              size="small"
              label="Panel title"
              placeholder={PANEL_TYPES[type]}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 100 } }}
            />
            <TextField select size="small" label="Width" value={size} onChange={(e) => setSize(e.target.value as Size)}>
              {Object.entries(PANEL_SIZES).map(([key, value]) => (
                <MenuItem key={key} value={key}>
                  {value}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            Save panel
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function BoardEditor({
  mode,
  board,
  onSave,
  onClose,
}: {
  mode: BoardDialog;
  board: DashboardConfig;
  onSave(board: DashboardConfig | null): void;
  onClose(): void;
}) {
  const [name, setName] = useState(mode === 'create' ? '' : mode === 'duplicate' ? `${board.name} copy` : board.name);
  const [interval, setInterval] = useState(board.refreshInterval);
  const [window, setWindow] = useState<MetricWindow>(board.window);
  const [raw, setRaw] = useState(mode === 'export' ? exportBoard(board) : '');
  const [error, setError] = useState('');
  const portable = mode === 'export' || mode === 'import';
  const titles: Record<BoardDialog, string> = {
    create: 'New dashboard',
    settings: 'Dashboard settings',
    duplicate: 'Duplicate dashboard',
    delete: 'Delete dashboard',
    import: 'Import layout',
    export: 'Export layout',
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth={portable ? 'sm' : 'xs'}>
      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          try {
            if (mode === 'export') {
              onClose();
              return;
            }
            if (mode === 'delete') {
              onSave(null);
              return;
            }
            if (mode === 'import') {
              onSave(importBoard(raw));
              return;
            }
            if (!name.trim()) throw new Error('Enter a dashboard name.');
            const next =
              mode === 'create'
                ? blankBoard(name.trim())
                : { ...board, id: mode === 'duplicate' ? dashboardId() : board.id };
            onSave({ ...next, name: name.trim(), refreshInterval: interval, window });
          } catch (err) {
            setError(message(err));
          }
        }}
      >
        <DialogTitle>{titles[mode]}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {portable ? (
              <TextField
                multiline
                minRows={7}
                maxRows={16}
                size="small"
                label="Layout JSON"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                slotProps={{
                  input: { readOnly: mode === 'export' },
                  htmlInput: { maxLength: 131072, spellCheck: false },
                }}
                helperText={
                  mode === 'export'
                    ? 'Copy this versioned layout to another browser or workspace. Measurements are read at the destination.'
                    : 'A valid layout opens as a separate dashboard.'
                }
              />
            ) : mode === 'delete' ? (
              <Typography>
                Delete “{board.name}” and its {board.panels.length} panels from this browser?
              </Typography>
            ) : (
              <>
                <TextField
                  label="Dashboard name"
                  size="small"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  slotProps={{ htmlInput: { maxLength: 100 } }}
                />
                <TextField
                  select
                  size="small"
                  label="Refresh interval"
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                >
                  {REFRESH_INTERVALS.map((ms) => (
                    <MenuItem key={ms} value={ms}>
                      {ms / 1000} seconds
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="History window"
                  value={window}
                  onChange={(e) => setWindow(e.target.value as MetricWindow)}
                >
                  {Object.entries(METRIC_WINDOWS).map(([key, period]) => (
                    <MenuItem key={key} value={key}>
                      {period.label}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          {mode !== 'export' && <Button onClick={onClose}>Cancel</Button>}
          <Button type="submit" variant="contained" color={mode === 'delete' ? 'error' : 'primary'}>
            {mode === 'delete' ? 'Delete' : mode === 'export' ? 'Done' : mode === 'import' ? 'Import' : 'Save'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export default function DashboardBuilderPage() {
  const [initial] = useState(initialLayouts);
  const [boards, setBoards] = useState(initial.boards);
  const [selected, setSelected] = useState(() => readStored(ACTIVE_KEY) ?? '');
  const board = boards.find((item) => item.id === selected) ?? boards[0]!;
  const [saveError, setSaveError] = useState(initial.error);
  const stored = useRef(initial.raw);
  const [editing, setEditing] = useState(false);
  const [live, setLive] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; panel?: DashboardPanel } | null>(null);
  const [dialog, setDialog] = useState<BoardDialog | null>(null);
  const [panel, setPanel] = useState<DashboardPanel | null>(null);
  const { sources, refresh } = useDashboardSources(board, live);
  const select = (id: string) => {
    setSelected(id);
    writeStored(ACTIVE_KEY, id);
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== LAYOUT_KEY || event.newValue === stored.current) return;
      if (dialog || panel) {
        setSaveError('Layouts changed in another tab. Close the editor and reload before saving.');
        return;
      }
      try {
        const next = event.newValue ? parseBoards(event.newValue) : [defaultBoard()];
        stored.current = event.newValue;
        setBoards(next);
        setSaveError(null);
      } catch (err) {
        setSaveError(message(err));
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [dialog, panel]);
  function commit(next: DashboardConfig[], id: string) {
    if (initial.error) {
      setSaveError(initial.error);
      return false;
    }
    if (readStored(LAYOUT_KEY) !== stored.current) {
      setSaveError('Saved layouts changed. Reload before editing to preserve both versions.');
      return false;
    }
    const raw = JSON.stringify(next);
    const persisted = writeStored(LAYOUT_KEY, raw);
    if (persisted) stored.current = raw;
    setSaveError(
      persisted ? null : 'Browser storage unavailable. Changes apply to this session. Export the layout to keep it.'
    );
    setBoards(next);
    select(id);
    return true;
  }
  function setPanels(panels: DashboardPanel[]) {
    return commit(
      boards.map((b) => (b.id === board.id ? { ...b, panels } : b)),
      board.id
    );
  }
  const openBoard = (mode: BoardDialog) => {
    setMenu(null);
    setDialog(mode);
  };
  const selectedPanel = menu?.panel;
  const index = board.panels.findIndex((p) => p.id === selectedPanel?.id);
  const move = (direction: number) => {
    const panels = [...board.panels],
      target = index + direction;
    if (index >= 0 && target >= 0 && target < panels.length) {
      const [item] = panels.splice(index, 1);
      panels.splice(target, 0, item!);
      setPanels(panels);
    }
    setMenu(null);
  };
  const manual = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Breadcrumbs
        links={[{ name: 'Dashboard Builder' }]}
        action={
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
            <FormControlLabel
              sx={{ m: 0 }}
              control={<Switch size="small" checked={live} onChange={(e) => setLive(e.target.checked)} />}
              label="Live"
            />
            <IconButton
              size="small"
              aria-label="Refresh dashboard"
              disabled={refreshing}
              data-console-command="refresh"
              onClick={() => void manual()}
            >
              <RefreshIcon />
            </IconButton>
            <Button
              size="small"
              variant={editing ? 'contained' : 'text'}
              aria-pressed={editing}
              startIcon={<EditIcon />}
              onClick={() => setEditing(!editing)}
            >
              {editing ? 'Done' : 'Edit layout'}
            </Button>
          </Stack>
        }
      />
      <Stack direction="row" useFlexGap spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Dashboard"
          value={board.id}
          onChange={(e) => select(e.target.value)}
          sx={{ minWidth: '10rem', maxWidth: '100%' }}
        >
          {boards.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.name}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="caption" color="text.secondary">
          {sources.subject} · {METRIC_WINDOWS[board.window].label} ·{' '}
          {live ? `${board.refreshInterval / 1000} s refresh` : 'Paused'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {editing && (
          <Button
            size="small"
            disabled={board.panels.length >= 64}
            startIcon={<PlusIcon />}
            onClick={() => setPanel(newPanel())}
          >
            Add panel
          </Button>
        )}
        <IconButton
          size="small"
          aria-label="Dashboard options"
          aria-haspopup="menu"
          onClick={(e) => setMenu({ anchor: e.currentTarget })}
        >
          <MoreVertIcon />
        </IconButton>
      </Stack>
      {saveError && <Alert severity="warning">{saveError}</Alert>}
      <OperationStatus active={refreshing} label="Refreshing dashboard sources" />
      {!board.panels.length && (
        <Alert severity="info">
          This dashboard has no panels.{' '}
          <Button
            size="small"
            onClick={() => {
              setEditing(true);
              setPanel(newPanel());
            }}
          >
            Add panel
          </Button>
        </Alert>
      )}
      <Grid container spacing={1.5}>
        {board.panels.map((p) => (
          <Grid key={p.id} size={GRID[p.size]} sx={{ minWidth: 0 }}>
            <DashboardWidget
              panel={p}
              board={board}
              sources={sources}
              actions={
                editing && (
                  <IconButton
                    size="small"
                    aria-label={`Options for ${p.title}`}
                    aria-haspopup="menu"
                    onClick={(e) => setMenu({ anchor: e.currentTarget, panel: p })}
                  >
                    <MoreVertIcon />
                  </IconButton>
                )
              }
            />
          </Grid>
        ))}
      </Grid>
      <Menu open={Boolean(menu)} anchorEl={menu?.anchor ?? null} onClose={() => setMenu(null)}>
        {selectedPanel
          ? [
              <MenuItem
                key="edit"
                onClick={() => {
                  setPanel(selectedPanel);
                  setMenu(null);
                }}
              >
                Edit panel
              </MenuItem>,
              <MenuItem key="up" disabled={index <= 0} onClick={() => move(-1)}>
                Move earlier
              </MenuItem>,
              <MenuItem key="down" disabled={index === board.panels.length - 1} onClick={() => move(1)}>
                Move later
              </MenuItem>,
              <MenuItem
                key="remove"
                onClick={() => {
                  setPanels(board.panels.filter((p) => p.id !== selectedPanel.id));
                  setMenu(null);
                }}
              >
                Remove from layout
              </MenuItem>,
            ]
          : (['settings', 'create', 'duplicate', 'import', 'export', 'delete'] as const).map((mode) => (
              <MenuItem
                key={mode}
                disabled={
                  (mode === 'delete' && boards.length === 1) ||
                  (['create', 'duplicate', 'import'].includes(mode) && boards.length >= 64)
                }
                onClick={() => openBoard(mode)}
              >
                {
                  {
                    settings: 'Settings',
                    create: 'New dashboard',
                    duplicate: 'Duplicate',
                    import: 'Import layout',
                    export: 'Export layout',
                    delete: 'Delete dashboard',
                  }[mode]
                }
              </MenuItem>
            ))}
      </Menu>
      {panel && (
        <PanelEditor
          panel={panel}
          edit={board.panels.some((p) => p.id === panel.id)}
          apps={[...new Set(sources.apps.data?.map((app) => app.name) ?? [])].sort()}
          onClose={() => setPanel(null)}
          onSave={(next) => {
            const exists = board.panels.some((p) => p.id === next.id);
            if (setPanels(exists ? board.panels.map((p) => (p.id === next.id ? next : p)) : [...board.panels, next]))
              setPanel(null);
          }}
        />
      )}
      {dialog && (
        <BoardEditor
          mode={dialog}
          board={board}
          onClose={() => setDialog(null)}
          onSave={(next) => {
            const updated = next
              ? dialog === 'settings'
                ? boards.map((b) => (b.id === next.id ? next : b))
                : [...boards, next]
              : boards.filter((b) => b.id !== board.id);
            if (commit(updated, next?.id ?? updated[0]!.id)) {
              setDialog(null);
              if (dialog === 'create') setEditing(true);
            }
          }}
        />
      )}
    </Stack>
  );
}
