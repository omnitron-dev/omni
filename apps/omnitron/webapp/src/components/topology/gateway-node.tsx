import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Typography } from '@mui/material';
import { DeployIcon } from 'src/assets/icons';
import { NodeCard } from './node-card';
import { serviceState, type GatewayNodeData } from './topology-store';

function GatewayNodeComponent({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const gateway = data as GatewayNodeData;
  return (
    <NodeCard
      sourcePosition={sourcePosition}
      targetPosition={targetPosition}
      title={gateway.label}
      icon={<DeployIcon />}
      status={serviceState(gateway)}
      selected={selected}
      source={false}
      meta={gateway.port != null ? `:${gateway.port}` : undefined}
    >
      <Typography noWrap color="text.secondary">
        {gateway.stack || 'Daemon'} ingress
      </Typography>
      {gateway.hasTor && <Typography>Tor enabled</Typography>}
    </NodeCard>
  );
}

export const GatewayNode = memo(GatewayNodeComponent);
