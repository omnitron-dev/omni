/**
 * ServerNode — a machine a stack runs on: its name, address, the daemon's
 * role there, and the apps it runs.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import { ServerIcon } from 'src/assets/icons';
import { glassCardSx, getStatusColor } from './shared-styles';
import type { ServerNodeData } from './topology-store';

// ---------------------------------------------------------------------------
// Role chip colors
// ---------------------------------------------------------------------------

/**
 * The daemon's role on the machine. These were the fleet registry's roles —
 * `leader`, `follower`, `worker` — from a registry the stacks do not deploy
 * to; the servers drawn now are the stacks' own nodes.
 */
const ROLE_COLORS: Record<string, string> = {
  master: '#818cf8',
  slave: '#22c55e',
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
          // The app chips wrap; left to grow, the card ran into the services beside it.
          maxWidth: 320,
          background: 'rgba(15, 15, 25, 0.92)',
          border: '1px solid', borderColor: 'divider',
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
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 700,
                letterSpacing: 0.3,
                lineHeight: 1.2
              }}>
              {nodeData.hostname}
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary', fontSize: 11 }}>
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
        <Stack
          direction="row"
          spacing={0.75}
          sx={{
            alignItems: "center",
            mb: 1.5
          }}>
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

        {/* Apps running on this server */}
        {nodeData.apps.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ mt: 1.5, pt: 1, borderTop: '1px solid', borderTopColor: 'divider', flexWrap: 'wrap', gap: 0.5 }}
          >
            {nodeData.apps.map((app) => (
              <Chip
                key={app}
                label={app}
                size="small"
                sx={{ height: 20, fontSize: 10, bgcolor: 'action.hover', color: 'text.primary' }}
              />
            ))}
          </Stack>
        )}
      </Box>
    </>
  );
}

export const ServerNode = memo(ServerNodeComponent);
