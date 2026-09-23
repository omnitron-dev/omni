/**
 * GatewayNode — Custom React Flow node for gateway/reverse proxy (OpenResty/Nginx)
 * with optional Tor hidden service indicator.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import { DeployIcon } from 'src/assets/icons';
import { glassCardSx, getStatusColor } from './shared-styles';
import { serviceState, type GatewayNodeData } from './topology-store';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function GatewayNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as unknown as GatewayNodeData;
  const state = serviceState(nodeData);
  const statusColor = getStatusColor(state);
  const isOnline = state === 'healthy' || state === 'running';

  return (
    <>
      <Handle type="target" position={Position.Left} style={{ background: '#3b82f6', width: 8, height: 8 }} />
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
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            mb: 1.5
          }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              bgcolor: 'rgba(59, 130, 246, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <DeployIcon sx={{ fontSize: 20, color: 'info.main' }} />
          </Box>

          <Stack spacing={0} sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                letterSpacing: 0.3,
                lineHeight: 1.2
              }}>
              {nodeData.label}
            </Typography>
            {nodeData.port !== null && (
              <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontSize: 11 }}>
                :{nodeData.port}
              </Typography>
            )}
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

        {/* Status + Tor chip */}
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: "center",
            mb: 1
          }}>
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
          {nodeData.hasTor && (
            <Chip
              label="Tor"
              size="small"
              sx={{
                height: 22,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: 'rgba(124, 58, 237, 0.15)',
                color: 'secondary.main',
                border: '1px solid rgba(124, 58, 237, 0.3)',
              }}
            />
          )}
        </Stack>

      </Box>
    </>
  );
}

export const GatewayNode = memo(GatewayNodeComponent);
