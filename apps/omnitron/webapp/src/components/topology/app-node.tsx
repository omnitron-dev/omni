/**
 * AppNode — Custom React Flow node for Omnitron applications
 * (main, storage, messaging, pricing, etc.)
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import { AppsIcon } from 'src/assets/icons';
import { glassCardSx, getStatusColor, selectedGlowSx } from './shared-styles';
import { formatBytes, formatCpu } from 'src/utils/metric-series';
import { useTheme, alpha } from '@mui/material/styles';
import type { AppNodeData } from './topology-store';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AppNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AppNodeData;
  const theme = useTheme();
  const statusColor = getStatusColor(nodeData.status, theme);
  const isOnline = nodeData.status === 'online';

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: theme.palette.primary.main, width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: theme.palette.primary.main, width: 8, height: 8 }}
      />
      <Box
        sx={{
          ...glassCardSx,
          p: 2,
          cursor: 'pointer',
          ...(selected && selectedGlowSx),
        }}
      >
        {/* Header */}
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: 'center',
            mb: 1,
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              bgcolor: alpha(statusColor, 0.1),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <AppsIcon sx={{ fontSize: 20, color: statusColor }} />
          </Box>

          <Stack spacing={0} sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                letterSpacing: 0.3,
                overflowWrap: 'anywhere',
                lineHeight: 1.2,
              }}
            >
              {nodeData.label}
            </Typography>
            <Stack
              direction="row"
              spacing={0.5}
              sx={{
                alignItems: 'center',
              }}
            >
              {nodeData.port && (
                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontSize: 11 }}>
                  :{nodeData.port}
                </Typography>
              )}
              {nodeData.instances > 1 && (
                <Chip
                  label={`x${nodeData.instances}`}
                  size="small"
                  sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(99,102,241,0.15)', color: 'primary.main' }}
                />
              )}
            </Stack>
          </Stack>

          {/* Status dot */}
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: statusColor,
              flexShrink: 0,
            }}
          />
        </Stack>

        {/* Status chip row */}
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: 'center',
            mb: 1.5,
          }}
        >
          <Chip
            label={nodeData.status}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              fontWeight: 600,
              bgcolor: alpha(statusColor, 0.1),
              color: statusColor,
              border: `1px solid ${alpha(statusColor, 0.2)}`,
              textTransform: 'capitalize',
            }}
          />
          {nodeData.pid && (
            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'text.secondary' }}>
              PID {nodeData.pid}
            </Typography>
          )}
          {nodeData.restarts > 0 && (
            <Chip
              label={`${nodeData.restarts} restarts`}
              size="small"
              sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(239,68,68,0.12)', color: 'error.main' }}
            />
          )}
        </Stack>

        {isOnline && (
          <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              CPU{' '}
              <Box component="span" sx={{ color: 'text.primary' }}>
                {formatCpu(nodeData.cpu)}
              </Box>
            </Typography>
            <Typography variant="caption" color="text.secondary">
              RSS{' '}
              <Box component="span" sx={{ color: 'text.primary' }}>
                {formatBytes(nodeData.memory)}
              </Box>
            </Typography>
          </Stack>
        )}

        {/* Sub-processes */}
        {nodeData.processes && nodeData.processes.length > 0 && (
          <Stack
            spacing={0.5}
            sx={{
              mt: 1,
              pt: 1,
              borderTop: '1px solid',
              borderTopColor: 'divider',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontSize: 10,
                color: 'text.secondary',
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              Processes
            </Typography>
            {nodeData.processes.map((proc) => {
              const procColor = getStatusColor(proc.status, theme);
              return (
                <Stack
                  key={proc.name}
                  direction="row"
                  spacing={0.75}
                  sx={{
                    alignItems: 'center',
                  }}
                >
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: procColor, flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ fontSize: 11, color: 'text.primary', flex: 1 }}>
                    {proc.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                    {proc.type}
                  </Typography>
                </Stack>
              );
            })}
          </Stack>
        )}
      </Box>
    </>
  );
}

export const AppNode = memo(AppNodeComponent);
