/**
 * InfrastructureNode — Custom React Flow node for infrastructure services
 * (PostgreSQL, Redis, MinIO, etc.)
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import { BackupIcon } from 'src/assets/icons';
import { glassCardSx, getStatusColor, miniBarSx } from './shared-styles';
import type { InfraNodeData } from './topology-store';

// ---------------------------------------------------------------------------
// Icons per infra type
// ---------------------------------------------------------------------------

const INFRA_ICONS: Record<string, { emoji: string; color: string }> = {
  postgres: { emoji: '\uD83D\uDDC4', color: '#336791' },
  redis: { emoji: '\u26A1', color: '#dc382d' },
  minio: { emoji: '\uD83D\uDCE6', color: '#c72c48' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function InfraNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as InfraNodeData;
  const statusColor = getStatusColor(nodeData.health === 'none' ? nodeData.status : nodeData.health);
  const infraMeta = INFRA_ICONS[nodeData.service];
  const isOnline = nodeData.status === 'running' && (nodeData.health === 'healthy' || nodeData.health === 'none');

  return (
    <>
      <Handle type="source" position={Position.Right} style={{ background: statusColor, width: 8, height: 8 }} />

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
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              bgcolor: infraMeta?.color ? `${infraMeta.color}22` : 'rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <BackupIcon sx={{ fontSize: 20, color: infraMeta?.color ?? '#94a3b8' }} />
          </Box>

          <Stack spacing={0} sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="subtitle2"
              fontWeight={700}
              sx={{
                textTransform: 'capitalize',
                letterSpacing: 0.3,
                lineHeight: 1.2,
              }}
            >
              {nodeData.label}
            </Typography>
            <Typography
              variant="caption"
              sx={{ fontFamily: 'monospace', color: '#94a3b8', fontSize: 11 }}
            >
              :{nodeData.port}
            </Typography>
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

        {/* Status chip */}
        <Stack direction="row" spacing={1} alignItems="center">
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
          {nodeData.containerId && (
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                fontSize: 10,
                color: '#64748b',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 100,
              }}
            >
              {nodeData.containerId.slice(0, 12)}
            </Typography>
          )}
        </Stack>

        {/* Image info */}
        {nodeData.image && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 1,
              fontFamily: 'monospace',
              fontSize: 10,
              color: '#475569',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {nodeData.image}
          </Typography>
        )}
      </Box>
    </>
  );
}

export const InfraNode = memo(InfraNodeComponent);
