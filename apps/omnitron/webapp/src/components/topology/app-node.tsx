/**
 * AppNode — Custom React Flow node for Omnitron applications
 * (main, storage, messaging, priceverse, etc.)
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import { AppsIcon } from 'src/assets/icons';
import { glassCardSx, getStatusColor, miniBarSx } from './shared-styles';
import { formatMemory } from 'src/utils/formatters';
import type { AppNodeData } from './topology-store';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function AppNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AppNodeData;
  const statusColor = getStatusColor(nodeData.status);
  const isOnline = nodeData.status === 'online';
  const cpuPct = Math.min(100, nodeData.cpu);
  const memMb = nodeData.memory / (1024 * 1024);
  const memPct = Math.min(100, (memMb / 512) * 100); // 512MB as reference max

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: '#3b82f6', width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#3b82f6', width: 8, height: 8 }} />

      <Box
        sx={{
          ...glassCardSx,
          p: 2,
          cursor: 'pointer',
          ...(selected && {
            borderColor: 'rgba(99, 102, 241, 0.6)',
            boxShadow: '0 0 20px rgba(99, 102, 241, 0.15)',
          }),
        }}
      >
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              bgcolor: `${statusColor}18`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <AppsIcon sx={{ fontSize: 20, color: statusColor }} />
          </Box>

          <Stack spacing={0} sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ letterSpacing: 0.3, lineHeight: 1.2 }}>
              {nodeData.label}
            </Typography>
            <Stack direction="row" spacing={0.5} alignItems="center">
              {nodeData.port && (
                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: 11 }}>
                  :{nodeData.port}
                </Typography>
              )}
              {nodeData.instances > 1 && (
                <Chip
                  label={`x${nodeData.instances}`}
                  size="small"
                  sx={{ height: 16, fontSize: 10, bgcolor: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
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
              ...(isOnline && {
                animation: 'topoPulse 2s ease-in-out infinite',
              }),
            }}
          />
        </Stack>

        {/* Status chip row */}
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1.5 }}>
          <Chip
            label={nodeData.status}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              fontWeight: 600,
              bgcolor: `${statusColor}18`,
              color: statusColor,
              border: `1px solid ${statusColor}33`,
              textTransform: 'capitalize',
            }}
          />
          {nodeData.pid && (
            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>
              PID {nodeData.pid}
            </Typography>
          )}
          {nodeData.restarts > 0 && (
            <Chip
              label={`${nodeData.restarts} restarts`}
              size="small"
              sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(239,68,68,0.12)', color: '#f87171' }}
            />
          )}
        </Stack>

        {/* CPU / Memory mini bars */}
        {isOnline && (
          <Stack spacing={0.75} sx={{ mb: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="caption" sx={{ fontSize: 10, color: '#64748b', width: 28, flexShrink: 0 }}>
                CPU
              </Typography>
              <Box sx={miniBarSx(cpuPct, cpuPct > 80 ? '#ef4444' : cpuPct > 50 ? '#f59e0b' : '#22c55e')} />
              <Typography variant="caption" sx={{ fontSize: 10, color: '#94a3b8', width: 36, textAlign: 'right', flexShrink: 0 }}>
                {nodeData.cpu.toFixed(1)}%
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="caption" sx={{ fontSize: 10, color: '#64748b', width: 28, flexShrink: 0 }}>
                MEM
              </Typography>
              <Box sx={miniBarSx(memPct, memPct > 80 ? '#ef4444' : memPct > 50 ? '#f59e0b' : '#3b82f6')} />
              <Typography variant="caption" sx={{ fontSize: 10, color: '#94a3b8', width: 36, textAlign: 'right', flexShrink: 0 }}>
                {formatMemory(nodeData.memory)}
              </Typography>
            </Stack>
          </Stack>
        )}

        {/* Sub-processes */}
        {nodeData.processes && nodeData.processes.length > 0 && (
          <Stack
            spacing={0.5}
            sx={{
              mt: 1,
              pt: 1,
              borderTop: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Typography variant="caption" sx={{ fontSize: 10, color: '#64748b', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Processes
            </Typography>
            {nodeData.processes.map((proc) => {
              const procColor = getStatusColor(proc.status);
              return (
                <Stack key={proc.name} direction="row" alignItems="center" spacing={0.75}>
                  <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: procColor, flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ fontSize: 11, color: '#cbd5e1', flex: 1 }}>
                    {proc.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 10, color: '#64748b' }}>
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
