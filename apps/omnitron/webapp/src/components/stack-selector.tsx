/** Explicit, persistent workspace filter. Opening a detail page never changes it. */
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useProjectStore, useActiveProjectStacks } from '../stores/project.store';
import { getStatusColor } from './topology/shared-styles';

export function StackSelector() {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeProject = useProjectStore(s => s.activeProject);
  const activeStack = useProjectStore(s => s.activeStack);
  const readError = useProjectStore(s => activeProject ? s.stackReadErrors[activeProject] : null);
  const selectStack = useProjectStore(s => s.selectStack);
  const stacks = useActiveProjectStacks();
  const sortedStacks = useMemo(() => [...stacks].sort((a, b) => a.name.localeCompare(b.name)), [stacks]);
  if (!activeProject) return null;
  const unverified = Boolean(activeStack && !stacks.some(stack => stack.name === activeStack));

  return (
    <Tooltip
      title={menuOpen ? '' : readError
        ? 'Stack inventory unavailable. The current filter is retained; cached options may be stale.'
        : 'Filter workspace views. Opening a stack detail does not change this filter.'}
      slotProps={{ transition: { timeout: 0 } }}
    >
      <Select
        size="small"
        value={activeStack ?? ''}
        displayEmpty
        open={menuOpen}
        onOpen={() => setMenuOpen(true)}
        onClose={() => setMenuOpen(false)}
        onChange={event => selectStack(event.target.value || null)}
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
