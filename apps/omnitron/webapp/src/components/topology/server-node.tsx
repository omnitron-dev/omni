import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Typography } from '@mui/material';
import { ServerIcon } from 'src/assets/icons';
import { NodeCard } from './node-card';
import type { ServerNodeData } from './topology-store';

function ServerNodeComponent({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const server = data as ServerNodeData;
  return (
    <NodeCard
      sourcePosition={sourcePosition}
      targetPosition={targetPosition}
      title={server.hostname}
      icon={<ServerIcon />}
      status={server.status}
      selected={selected}
      meta={server.role}
    >
      <Typography noWrap title={server.address}>
        {server.address}
      </Typography>
      <Typography color="text.secondary">
        {server.apps.length} apps · {server.stacks.length} {server.stacks.length === 1 ? 'stack' : 'stacks'}
      </Typography>
    </NodeCard>
  );
}

export const ServerNode = memo(ServerNodeComponent);
