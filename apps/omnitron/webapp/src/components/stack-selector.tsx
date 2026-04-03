/**
 * StackSelector — Stack chips in header leftArea
 *
 * Shows ALL stacks for the current project as compact chips:
 *   dev [green dot] | prod [green dot] | test [gray dot]
 *
 * Click chip → filters views to that stack.
 * "All stacks" chip shows combined view.
 * Status dot: green=running, yellow=starting/stopping, red=error, gray=stopped.
 */

import { useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import {
  useProjectStore,
  useActiveProject,
  useActiveStack,
  useActiveProjectStacks,
} from '../stores/project.store';
import type { IStackInfo } from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Status dot colors
// =============================================================================

const STATUS_COLORS: Record<string, string> = {
  running: '#22c55e',
  starting: '#eab308',
  stopping: '#eab308',
  degraded: '#f97316',
  error: '#ef4444',
  stopped: '#6b7280',
};

function statusDot(status: string) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.stopped!;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        bgcolor: color,
        mr: 0.5,
        flexShrink: 0,
        ...(status === 'running' && {
          boxShadow: `0 0 4px ${color}`,
        }),
      }}
    />
  );
}

// =============================================================================
// Component
// =============================================================================

export function StackSelector() {
  const activeProject = useActiveProject();
  const activeStack = useActiveStack();
  const stacks = useActiveProjectStacks();
  const selectStack = useProjectStore((s) => s.selectStack);

  const handleSelect = useCallback(
    (name: string | null) => {
      selectStack(name);
    },
    [selectStack]
  );

  const sortedStacks = useMemo(() => {
    // Sort: running first, then by name
    return [...stacks].sort((a, b) => {
      const aRunning = a.status === 'running' ? 0 : 1;
      const bRunning = b.status === 'running' ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      return a.name.localeCompare(b.name);
    });
  }, [stacks]);

  if (!activeProject) return null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
      {/* "All" chip */}
      <Chip
        label="All"
        size="small"
        variant={activeStack === null ? 'filled' : 'outlined'}
        color={activeStack === null ? 'primary' : 'default'}
        onClick={() => handleSelect(null)}
        sx={{
          height: 24,
          fontSize: '0.7rem',
          fontWeight: activeStack === null ? 700 : 400,
          '& .MuiChip-label': { px: 1 },
        }}
      />

      {sortedStacks.map((stack) => (
        <StackChip
          key={stack.name}
          stack={stack}
          active={activeStack === stack.name}
          onClick={() => handleSelect(stack.name)}
        />
      ))}

      {stacks.length === 0 && (
        <Typography variant="caption" sx={{ color: 'text.disabled', ml: 0.5 }}>
          No stacks configured
        </Typography>
      )}
    </Box>
  );
}

// =============================================================================
// StackChip
// =============================================================================

function StackChip({
  stack,
  active,
  onClick,
}: {
  stack: IStackInfo;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Chip
      size="small"
      variant={active ? 'filled' : 'outlined'}
      color={active ? 'primary' : 'default'}
      onClick={onClick}
      label={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {statusDot(stack.status)}
          <span>{stack.name}</span>
          {stack.type !== 'local' && (
            <Typography
              component="span"
              sx={{
                fontSize: '0.55rem',
                ml: 0.25,
                opacity: 0.6,
                textTransform: 'uppercase',
              }}
            >
              {stack.type === 'remote' ? 'ssh' : 'cluster'}
            </Typography>
          )}
        </Box>
      }
      sx={{
        height: 24,
        fontSize: '0.7rem',
        fontWeight: active ? 700 : 400,
        '& .MuiChip-label': { px: 0.75 },
        ...(stack.status === 'running' && !active && {
          borderColor: (t) => alpha('#22c55e', 0.3),
        }),
      }}
    />
  );
}
