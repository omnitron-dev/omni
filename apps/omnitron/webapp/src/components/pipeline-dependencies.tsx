import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Alert } from '@omnitron-dev/prism/components/alert';
import type { PipelineStep } from '@omnitron-dev/omnitron/dto/services';
import {
  Background, Controls, getNodesBounds, getViewportForBounds, MarkerType, Position, ReactFlow, useReactFlow, useStore,
  type Edge, type Node, type Rect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { canConnectSteps, pipelineLevels } from './pipeline-graph';

type Props = {
  steps: PipelineStep[];
  selected: number;
  onSelect(index: number): void;
  onLink(from: string, to: string, connect: boolean): void;
};

function FitDependencies({ x, y, width: graphWidth, height: graphHeight }: Rect) {
  const { viewportInitialized, setViewport } = useReactFlow();
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  useEffect(() => {
    if (!viewportInitialized || !width || !height) return;
    const bounds = { x, y, width: graphWidth, height: graphHeight };
    void setViewport(getViewportForBounds(bounds, width, height, 0.12, 1, 0.18));
  }, [viewportInitialized, width, height, x, y, graphWidth, graphHeight, setViewport]);
  return null;
}

export function PipelineDependencies({ steps, selected, onSelect, onLink }: Props) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const current = steps[selected]!;
  const [selection, setSelection] = useState<{ from: string; to: string } | null>(null);
  const graph = useMemo(() => {
    try {
      const levels = pipelineLevels(steps);
      const rows = new Map<number, number>();
      const nodes: Node[] = steps.map((step, index) => {
        const level = levels.get(step.name)!;
        const row = rows.get(level) ?? 0;
        rows.set(level, row + 1);
        return {
          id: step.name, position: compact ? { x: row * 160, y: level * 68 } : { x: level * 224, y: row * 80 },
          width: compact ? 128 : 160, height: 42,
          sourcePosition: compact ? Position.Bottom : Position.Right, targetPosition: compact ? Position.Top : Position.Left,
          selected: index === selected, ariaLabel: `Step ${step.name}`, data: { label: <span title={step.name}>{step.name}</span> },
        };
      });
      const edges: Edge[] = steps.flatMap(step => [...new Set(step.dependsOn ?? [])].map(from => ({
        id: `${from}:${step.name}`, source: from, target: step.name, type: 'smoothstep',
        ariaLabel: `${from} to ${step.name}`, markerEnd: { type: MarkerType.ArrowClosed, color: theme.palette.text.secondary },
        style: { stroke: theme.palette.text.secondary, strokeWidth: 1.7 }, interactionWidth: 22,
      })));
      return { nodes, edges, bounds: getNodesBounds(nodes) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Invalid dependencies.' };
    }
  }, [steps, selected, theme.palette.text.secondary, compact]);
  if (!graph.nodes || !graph.edges)
    return <Alert severity="error">{graph.error} Open Advanced JSON to repair the graph.</Alert>;
  const prerequisites = [...new Set(current.dependsOn ?? [])];
  const choices = steps.filter(step => canConnectSteps(steps, step.name, current.name));
  const choice = selection?.to === current.name && choices.some(step => step.name === selection.from) ? selection.from : '';
  return (
    <Box component="section" aria-label="Step dependencies">
      <Box sx={{
        height: { xs: 205, sm: 250 }, border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden',
        '& .react-flow__node-default': {
          textAlign: 'start', p: 1.25, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          bgcolor: 'background.paper', color: 'text.primary', borderColor: 'divider',
        },
        '& .react-flow__node-default > span': { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        '& .react-flow__node-default.selected, & .react-flow__node-default:focus-visible': { borderColor: 'primary.main', outlineColor: 'primary.main' },
        '& .react-flow__handle': { width: 10, height: 10, bgcolor: 'primary.main', borderColor: 'background.paper' },
      }}>
        <ReactFlow nodes={graph.nodes} edges={graph.edges} nodesDraggable={false} edgesReconnectable={false}
          colorMode={theme.palette.mode} minZoom={0.12} maxZoom={2} preventScrolling={false}
          deleteKeyCode={null} aria-label="Pipeline dependency graph" proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => onSelect(steps.findIndex(step => step.name === node.id))}
          onConnect={({ source, target }) => onLink(source, target, true)}
          isValidConnection={({ source, target }) => canConnectSteps(steps, source, target)}
          onEdgeDoubleClick={(_, edge) => onLink(edge.source, edge.target, false)}>
          <Background gap={18} color={theme.palette.divider} />
          <Controls showInteractive={false} orientation="horizontal" position="bottom-right" />
          <FitDependencies {...graph.bounds} />
        </ReactFlow>
      </Box>
      <Typography component="p" variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
        Drag between ports to connect steps. Double-click an arrow to disconnect, or edit the prerequisites below.
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5, alignItems: { sm: 'center' } }}>
        <TextField select label={`Add prerequisite for ${current.name}`} value={choice} size="small" disabled={!choices.length}
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }} sx={{ minWidth: { sm: 225 } }}
          onChange={event => setSelection({ from: event.target.value, to: current.name })}>
          <option value="">{choices.length ? 'Choose a step' : 'No available steps'}</option>
          {choices.map(step => <option key={step.name} value={step.name}>{step.name}</option>)}
        </TextField>
        <Button size="small" variant="outlined" disabled={!choice} onClick={() => {
          onLink(choice, current.name, true);
          setSelection(null);
        }}>Connect</Button>
        {prerequisites.length ? (
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
            {prerequisites.map(from => <Button key={from} size="small" variant="outlined"
              aria-label={`Remove dependency from ${from} to ${current.name}`}
              onClick={() => onLink(from, current.name, false)}>{from} <span aria-hidden="true">&nbsp;×</span></Button>)}
          </Stack>
        ) : <Typography variant="body2" color="text.secondary">This step has no prerequisites.</Typography>}
      </Stack>
    </Box>
  );
}
