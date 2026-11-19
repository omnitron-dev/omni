import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useProjectStore, useActiveProjectStacks } from '../stores/project.store';
import { useAccess } from '../auth/access';
import { getStatusColor } from './topology/shared-styles';
import { stackHref, useWorkspace, workspaceHref } from '../routes/workspace';
import { consoleRoute } from '../routes/navigation';

/** Every choice is a browser history entry. Detail views always name a specific stack. */
export function StackSelector() {
  const location = useLocation();
  const navigate = useNavigate();
  const { project, stack, pagePath, appDetail, stackDetail } = useWorkspace();
  if (!project || !consoleRoute(location.pathname).stackFilter) return null;
  return <StackFilter onChange={chosen => {
    if (chosen === stack) return;
    if (stackDetail && chosen) { void navigate(stackHref(project, chosen)); return; }
    const path = stackDetail ? '/stacks' : appDetail ? '/apps' : pagePath;
    const params = new URLSearchParams(location.search);
    params.delete('stack');
    // A log handle may belong only to the stack being left.
    if (path === '/logs') { params.delete('app'); params.delete('node'); }
    if (path === '/studio') { params.delete('team'); params.delete('before'); }
    void navigate(workspaceHref({ project, stack: chosen }, path + '?' + params) + location.hash);
  }} />;
}

function StackFilter({ onChange }: { onChange: (name: string | null) => void }) {
  const { can } = useAccess();
  const [menuOpen, setMenuOpen] = useState(false);
  const { project: activeProject, stack: activeStack } = useWorkspace();
  const readError = useProjectStore(s => activeProject ? s.stackReadErrors[activeProject] : null);
  const stacks = useActiveProjectStacks();
  const sortedStacks = useMemo(() => [...stacks].sort((a, b) => a.name.localeCompare(b.name)), [stacks]);
  if (!activeProject) return null;
  if (!can('OmnitronProject.listStacks')) return activeStack ? <Typography variant="caption">Stack: {activeStack}</Typography> : null;
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
        renderValue={value => value ? (
          <><Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Stack: </Box>{value}</>
        ) : 'All stacks'}
        MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360, maxWidth: 'calc(100vw - 24px)' } } } }}
        sx={{
          minWidth: 104, maxWidth: { xs: 112, sm: 210 }, height: 30,
          fontSize: '0.75rem', flexShrink: 1,
          '& .MuiSelect-select': { py: 0.5 },
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
