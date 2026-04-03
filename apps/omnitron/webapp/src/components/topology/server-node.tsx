/**
 * ServerNode — Custom React Flow node for production fleet servers.
 * Shows hostname, IP, role, resource usage bars.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import { ServerIcon } from 'src/assets/icons';
import { glassCardSx, getStatusColor, miniBarSx } from './shared-styles';
import type { ServerNodeData } from './topology-store';

// ---------------------------------------------------------------------------
// Role chip colors
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<string, string> = {
  leader: '#818cf8',
  follower: '#94a3b8',
  database: '#60a5fa',
  cache: '#f59e0b',
  app: '#22c55e',
  gateway: '#3b82f6',
  worker: '#a78bfa',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function ServerNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as ServerNodeData;
  const statusColor = getStatusColor(nodeData.status);
  const roleColor = ROLE_COLORS[nodeData.role] ?? '#94a3b8';
  const isOnline = nodeData.status === 'online';

  return (
    <>
      <Handle type="source" position={Position.Right} style={{ background: roleColor, width: 8, height: 8 }} />
      <Handle type="target" position={Position.Left} style={{ background: roleColor, width: 8, height: 8 }} />

      <Box
        sx={{
          ...glassCardSx,
          p: 2,
          cursor: 'pointer',
          minWidth: 300,
          background: 'rgba(15, 15, 25, 0.92)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          ...(selected && {
            borderColor: 'rgba(99, 102, 241, 0.6)',
            boxShadow: '0 0 20px rgba(99, 102, 241, 0.15)',
          }),
        }}
      >
        {/* Header */}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: '10px',
              bgcolor: `${roleColor}18`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ServerIcon sx={{ fontSize: 22, color: roleColor }} />
          </Box>

          <Stack spacing={0} sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ letterSpacing: 0.3, lineHeight: 1.2 }}>
              {nodeData.hostname}
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: 11 }}>
              {nodeData.address}
            </Typography>
          </Stack>

          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: statusColor,
              flexShrink: 0,
              ...(isOnline && { animation: 'topoPulse 2s ease-in-out infinite' }),
            }}
          />
        </Stack>

        {/* Role + Status */}
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1.5 }}>
          <Chip
            label={nodeData.role}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              fontWeight: 600,
              bgcolor: `${roleColor}18`,
              color: roleColor,
              border: `1px solid ${roleColor}33`,
              textTransform: 'capitalize',
            }}
          />
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
        </Stack>

        {/* Resource bars */}
        {isOnline && (
          <Stack spacing={0.75}>
            {nodeData.cpu !== undefined && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" sx={{ fontSize: 10, color: '#64748b', width: 28, flexShrink: 0 }}>
                  CPU
                </Typography>
                <Box sx={miniBarSx(nodeData.cpu, nodeData.cpu > 80 ? '#ef4444' : nodeData.cpu > 50 ? '#f59e0b' : '#22c55e')} />
                <Typography variant="caption" sx={{ fontSize: 10, color: '#94a3b8', width: 36, textAlign: 'right', flexShrink: 0 }}>
                  {nodeData.cpu.toFixed(0)}%
                </Typography>
              </Stack>
            )}
            {nodeData.memory !== undefined && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" sx={{ fontSize: 10, color: '#64748b', width: 28, flexShrink: 0 }}>
                  MEM
                </Typography>
                <Box sx={miniBarSx(nodeData.memory, nodeData.memory > 80 ? '#ef4444' : nodeData.memory > 50 ? '#f59e0b' : '#3b82f6')} />
                <Typography variant="caption" sx={{ fontSize: 10, color: '#94a3b8', width: 36, textAlign: 'right', flexShrink: 0 }}>
                  {nodeData.memory.toFixed(0)}%
                </Typography>
              </Stack>
            )}
            {nodeData.disk !== undefined && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" sx={{ fontSize: 10, color: '#64748b', width: 28, flexShrink: 0 }}>
                  DSK
                </Typography>
                <Box sx={miniBarSx(nodeData.disk, nodeData.disk > 90 ? '#ef4444' : nodeData.disk > 70 ? '#f59e0b' : '#94a3b8')} />
                <Typography variant="caption" sx={{ fontSize: 10, color: '#94a3b8', width: 36, textAlign: 'right', flexShrink: 0 }}>
                  {nodeData.disk.toFixed(0)}%
                </Typography>
              </Stack>
            )}
          </Stack>
        )}

        {/* Apps running on this server */}
        {nodeData.apps.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ mt: 1.5, pt: 1, borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap', gap: 0.5 }}
          >
            {nodeData.apps.map((app) => (
              <Chip
                key={app}
                label={app}
                size="small"
                sx={{ height: 20, fontSize: 10, bgcolor: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }}
              />
            ))}
          </Stack>
        )}
      </Box>
    </>
  );
}

export const ServerNode = memo(ServerNodeComponent);
