import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Stack, Typography } from '@mui/material';
import { AppsIcon } from 'src/assets/icons';
import { formatBytes, formatCpu } from 'src/utils/metric-series';
import { NodeCard } from './node-card';
import type { AppNodeData } from './topology-store';

function AppNodeComponent({ data, selected, sourcePosition, targetPosition }: NodeProps) {
  const app = data as AppNodeData;
  const details = [app.port != null ? `:${app.port}` : null, app.instances > 1 ? `${app.instances} instances` : null]
    .filter(Boolean)
    .join(' · ');
  const processCount = app.processes?.length ?? 0;
  const summary = [
    processCount ? `${processCount} ${processCount === 1 ? 'process' : 'processes'}` : null,
    app.restarts ? `${app.restarts} ${app.restarts === 1 ? 'restart' : 'restarts'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <NodeCard
      sourcePosition={sourcePosition}
      targetPosition={targetPosition}
      title={app.label}
      icon={<AppsIcon />}
      status={app.status}
      selected={selected}
      meta={details}
    >
      {app.status === 'online' && (
        <Stack direction="row" spacing={2}>
          <Typography noWrap title={`CPU ${formatCpu(app.cpu)}`} sx={{ minWidth: 0 }}>
            CPU {formatCpu(app.cpu)}
          </Typography>
          <Typography noWrap title={`RSS ${formatBytes(app.memory)}`} sx={{ minWidth: 0 }}>
            RSS {formatBytes(app.memory)}
          </Typography>
        </Stack>
      )}
      <Typography noWrap color="text.secondary" title={summary || undefined}>
        {summary || (app.remote ? 'Remote application' : 'Local application')}
      </Typography>
    </NodeCard>
  );
}

export const AppNode = memo(AppNodeComponent);
