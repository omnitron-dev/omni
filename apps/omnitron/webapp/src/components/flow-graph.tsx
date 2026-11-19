import { memo, useEffect, useMemo, useState } from 'react';
import { Box, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowDefinition, FlowNodeDescriptor, FlowPreview } from '@omnitron-dev/omnitron/dto/services';

type Wire = FlowDefinition['edges'][number];
type VisualNode = Node<{
  id: string;
  label: string;
  group: FlowNodeDescriptor['group'];
  ports: string[];
  compact: boolean;
  visited: boolean;
}>;
export const edgeKey = (edge: Wire) => [edge.from, edge.port, edge.to].join(':');

export function canWire(
  definition: FlowDefinition,
  catalog: FlowNodeDescriptor[],
  from: string,
  port: string,
  to: string
) {
  const source = catalog.find((item) => item.type === definition.nodes.find((n) => n.id === from)?.type);
  const target = catalog.find((item) => item.type === definition.nodes.find((n) => n.id === to)?.type);
  if (
    !source?.ports.includes(port) ||
    !target ||
    target.group === 'source' ||
    from === to ||
    definition.edges.some((edge) => edge.to === to)
  )
    return false;
  // Each input accepts one upstream wire. Following those wires also detects a proposed cycle.
  const parents = new Map(definition.edges.map((edge) => [edge.to, edge.from]));
  const seen = new Set<string>();
  let parent: string | undefined = from;
  while (parent && !seen.has(parent)) {
    if (parent === to) return false;
    seen.add(parent);
    parent = parents.get(parent);
  }
  return true;
}

const NodeCard = memo(function ComponentNode({ data, selected }: NodeProps<VisualNode>) {
  const { compact, ports } = data;
  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
        bgcolor: 'background.paper',
        borderRadius: 1,
        border: '1.5px solid',
        borderColor: selected ? 'primary.main' : data.visited ? 'success.main' : 'divider',
        overflow: 'visible',
        boxShadow: (theme) => (data.visited ? 'inset 4px 0 ' + theme.palette.success.main : 'none'),
        px: 1.2,
        py: 0.7,
      }}
    >
      {data.group !== 'source' && <Handle type="target" position={compact ? Position.Top : Position.Left} />}
      <Typography component="div" variant="caption" color="text.secondary" noWrap>
        {data.label}
      </Typography>
      <Typography component="div" variant="subtitle2" noWrap>
        {data.id}
      </Typography>
      {ports.length > 1 && (
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-around', pt: 0.25 }}>
          {ports.map((port) => (
            <Typography key={port} component="span" variant="caption" color="text.secondary">
              {port}
            </Typography>
          ))}
        </Stack>
      )}
      {ports.map((port, index) => (
        <Handle
          key={port}
          type="source"
          id={port}
          aria-label={data.id + ' output ' + port}
          position={compact ? Position.Bottom : Position.Right}
          style={{ [compact ? 'left' : 'top']: ((index + 1) * 100) / (ports.length + 1) + '%' }}
        />
      ))}
    </Box>
  );
});
const nodeTypes = { component: NodeCard };

/** Fit only when the structure or available space changes, keeping operator panning and dragging intact. */
function FitGraph({ structure }: { structure: string }) {
  const { fitView, viewportInitialized } = useReactFlow();
  const width = useStore((state) => state.width),
    height = useStore((state) => state.height);
  useEffect(() => {
    if (!viewportInitialized || !width || !height) return undefined;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.18, minZoom: 0.22, maxZoom: 1.1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [structure, width, height, viewportInitialized, fitView]);
  return null;
}

export function FlowGraph({
  editable,
  definition,
  catalog,
  selected,
  preview,
  onSelect,
  onConnect,
  onDisconnect,
}: {
  editable: boolean;
  definition: FlowDefinition;
  catalog: FlowNodeDescriptor[];
  selected: string | null;
  preview: FlowPreview | null;
  onSelect: (id: string) => void;
  onConnect: (edge: Wire) => void;
  onDisconnect: (edge: Wire) => void;
}) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const [positions, setPositions] = useState<Record<string, XYPosition>>({});
  const structure = JSON.stringify([compact, definition.nodes.map((node) => node.id), definition.edges]);
  const nodes = useMemo(() => {
    const parents = new Map(definition.edges.map((edge) => [edge.to, edge.from]));
    const rows = new Map<number, number>();
    return definition.nodes.map((node): VisualNode => {
      let parent = parents.get(node.id);
      const seen = new Set<string>();
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        parent = parents.get(parent);
      }
      const level = seen.size,
        row = rows.get(level) ?? 0;
      rows.set(level, row + 1);
      const item = catalog.find((c) => c.type === node.type);
      // A Studio proposal also carries concrete ports when its reader lacks access to the controller catalog.
      const ports = item?.ports ?? [
        ...new Set(definition.edges.filter((edge) => edge.from === node.id).map((edge) => edge.port)),
      ];
      const group = item?.group ?? (ports.length ? (parents.has(node.id) ? 'transform' : 'source') : 'output');
      const key = Number(compact) + ':' + node.id;
      const position =
        positions[key] ?? (compact ? { x: row * 178, y: level * 120 } : { x: level * 234, y: row * 119 });
      return {
        id: node.id,
        type: 'component',
        width: compact ? 152 : 172,
        height: ports.length > 1 ? 74 : 55,
        position,
        selected: node.id === selected,
        ariaLabel: 'Flow node ' + node.id,
        data: {
          id: node.id,
          label: item?.label ?? node.type,
          group,
          compact,
          ports,
          visited: !!preview?.visited.includes(node.id),
        },
      };
    });
  }, [definition, catalog, selected, preview, compact, positions]);
  const edges: Edge[] = definition.edges.map((wire) => {
    const traversed = preview?.traversed?.some((edge) => edgeKey(edge) === edgeKey(wire));
    const color = traversed ? theme.palette.success.main : theme.palette.text.secondary;
    return {
      id: edgeKey(wire),
      source: wire.from,
      target: wire.to,
      sourceHandle: wire.port,
      label: wire.port,
      ariaLabel: wire.from + ' ' + wire.port + ' to ' + wire.to,
      markerEnd: { type: MarkerType.ArrowClosed, color },
      type: 'smoothstep',
      style: { stroke: color, strokeWidth: traversed ? 3 : 1.5 },
      labelStyle: { fill: color, fontSize: 11 },
      labelBgStyle: { fill: theme.palette.background.default },
    };
  });
  const connectable = (c: Connection | Edge) =>
    !!c.sourceHandle && canWire(definition, catalog, c.source, c.sourceHandle, c.target);
  return (
    <Box
      role="region"
      aria-label="Flow graph"
      sx={{
        height: { xs: 365, md: 350 },
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.default',
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
        '& .react-flow__handle': { height: 12, width: 12, bgcolor: 'primary.main', borderColor: 'background.paper' },
        '& .react-flow__node:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={theme.palette.mode}
        minZoom={0.18}
        maxZoom={2.5}
        deleteKeyCode={null}
        preventScrolling={false}
        elevateNodesOnSelect
        nodesConnectable={editable}
        edgesReconnectable={false}
        proOptions={{ hideAttribution: true }}
        onNodesChange={(changes) => {
          for (const change of changes) {
            if (change.type === 'position' && change.position) {
              const next = change.position;
              setPositions((prev) => ({ ...prev, [Number(compact) + ':' + change.id]: next }));
            } else if (change.type === 'select' && change.selected) onSelect(change.id);
          }
        }}
        onNodeClick={(_, node) => onSelect(node.id)}
        onConnect={(connection) => {
          if (connection.sourceHandle && connectable(connection))
            onConnect({ from: connection.source, port: connection.sourceHandle, to: connection.target });
        }}
        isValidConnection={connectable}
        onEdgeDoubleClick={(_, edge) => {
          const wire = definition.edges.find((item) => edgeKey(item) === edge.id);
          if (wire) onDisconnect(wire);
        }}
      >
        <Background gap={18} color={theme.palette.divider} />
        <Controls position="bottom-right" orientation="horizontal" showInteractive={false} />
        <FitGraph structure={structure} />
      </ReactFlow>
      {!nodes.length && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ position: 'absolute', inset: '45% 15% auto', textAlign: 'center', pointerEvents: 'none' }}
        >
          Add a source from the node library to start the graph.
        </Typography>
      )}
    </Box>
  );
}
