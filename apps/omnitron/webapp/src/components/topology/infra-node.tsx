import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Typography } from '@mui/material';
import { BackupIcon } from 'src/assets/icons';
import { NodeCard } from './node-card';
import { serviceState, type InfraNodeData } from './topology-store';

function InfraNodeComponent({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const service = data as InfraNodeData;
  return (
    <NodeCard
      sourcePosition={sourcePosition}
      targetPosition={targetPosition}
      title={service.label}
      icon={<BackupIcon />}
      status={serviceState(service)}
      selected={selected}
      target={false}
      meta={service.port != null ? `:${service.port}` : undefined}
    >
      <Typography noWrap color="text.secondary" title={service.image}>
        {service.image || 'Infrastructure service'}
      </Typography>
      {service.app && (
        <Typography noWrap title={`For ${service.app}`}>
          For {service.app}
        </Typography>
      )}
    </NodeCard>
  );
}

export const InfraNode = memo(InfraNodeComponent);
