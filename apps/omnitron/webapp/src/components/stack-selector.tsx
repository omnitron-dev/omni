/** Explicit, persistent workspace filter. Opening a detail page never changes it. */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useProjectStore, useActiveProjectStacks } from '../stores/project.store';
import { useAccess } from '../auth/access';
import { getStatusColor } from './topology/shared-styles';

/** Store the workspace with each history entry, including entries reached by a sidebar link. */
export function StackSelector() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigationType();
  const project = useProjectStore(s => s.activeProject);
  const stack = useProjectStore(s => s.activeStack);
  const restore = useProjectStore(s => s.restoreWorkspace);
  const lastEntry = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (lastEntry.current === location.key) return;
    lastEntry.current = location.key;
    const saved = location.state?.workspace;
    if (saved &&
        (saved.project === null || typeof saved.project === 'string') &&
        (saved.stack === null || typeof saved.stack === 'string')) {
      if (navigation === 'POP') restore(saved.project, saved.stack);
      return;
    }
    // Stamp an unstamped entry once. A store update can render before its
    // matching router push and must never rewrite the entry we are leaving.
    void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, {
      replace: true, preventScrollReset: true, state: { ...location.state, workspace: { project, stack } },
    });
  }, [location, navigate, navigation, project, stack, restore]);

  const segments = location.pathname.split('/').filter(Boolean);
  const page = segments[0] ?? 'dashboard';
  const stackDetail = page === 'stacks' && segments.length === 2;
  if (!stackDetail && (segments.length > 1 || !STACK_VIEWS.has(page))) return null;
  return <StackFilter onChange={chosen => {
    const state = useProjectStore.getState();
    if (state.activeStack === chosen) return;
    state.selectStack(chosen);
    if (useProjectStore.getState().activeStack !== chosen) return;
    const pathname = stackDetail ? (chosen ? '/stacks/' + encodeURIComponent(chosen) : '/stacks') : location.pathname;
    void navigate({ pathname, search: location.search, hash: location.hash }, {
      preventScrollReset: true, state: { ...location.state, workspace: { project, stack: chosen } },
    });
  }} />;
}

const STACK_VIEWS = new Set(['dashboard', 'dashboard-builder', 'stacks', 'apps', 'logs', 'metrics', 'topology', 'containers', 'deployments', 'releases']);

function StackFilter({ onChange }: { onChange: (name: string | null) => void }) {
  const { can } = useAccess();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeProject = useProjectStore(s => s.activeProject);
  const activeStack = useProjectStore(s => s.activeStack);
  const readError = useProjectStore(s => activeProject ? s.stackReadErrors[activeProject] : null);
  const stacks = useActiveProjectStacks();
  const sortedStacks = useMemo(() => [...stacks].sort((a, b) => a.name.localeCompare(b.name)), [stacks]);
  if (!activeProject || !can('OmnitronProject.listStacks')) return null;
  const unverified = Boolean(activeStack && !stacks.some(stack => stack.name === activeStack));

  return (
    <Tooltip
      title={menuOpen ? '' : readError
        ? 'Stack inventory unavailable. The current filter is retained; cached options may be stale.'
        : 'Filter workspace views by stack'}
      slotProps={{
        // A pending placement from a wider window must not enlarge the page
        // while Popper catches up with a resize of this viewport-bound header.
        popper: { popperOptions: { strategy: 'fixed' } },
        transition: { timeout: 0 },
      }}
    >
      <Select
        size="small"
        value={activeStack ?? ''}
        displayEmpty
        open={menuOpen}
        onOpen={() => setMenuOpen(true)}
        onClose={() => setMenuOpen(false)}
        onChange={event => onChange(event.target.value || null)}
        inputProps={{ 'aria-label': 'Stack filter' }}
        renderValue={value => value ? `Stack: ${value}` : 'All stacks'}
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360, maxWidth: 'calc(100vw - 24px)' } } } }}
        sx={{
          minWidth: 104, maxWidth: { xs: 112, sm: 210 }, height: 30,
          fontSize: '0.75rem', flexShrink: 1,
          '& .MuiSelect-select': { minWidth: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', py: 0.5 },
          ...(readError || unverified ? { color: 'warning.main' } : {}),
        }}
      >
        <MenuItem value="" sx={{ fontSize: '0.8rem' }}>All stacks</MenuItem>
        {unverified && <MenuItem value={activeStack!} disabled>{activeStack} · awaiting inventory</MenuItem>}
        {sortedStacks.map(stack => (
          <MenuItem key={stack.name} value={stack.name} sx={{ gap: 1, minWidth: 0, fontSize: '0.8rem' }}>
            <Box component="span" aria-hidden sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: getStatusColor(stack.status), flexShrink: 0 }} />
            <Typography variant="inherit" noWrap sx={{ flex: 1, minWidth: 0 }}>{stack.name}</Typography>
            <Typography variant="caption" color="text.secondary">{readError ? 'last observed' : stack.status}</Typography>
          </MenuItem>
        ))}
      </Select>
    </Tooltip>
  );
}
