import { DocSidebar } from '../doc-layout/doc-sidebar.js';
('use client');
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ReactFlow,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  type Node,
  type NodeProps,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { PanelLayout } from '../../layouts/panel-layout.js';
import Dialog from '@mui/material/Dialog';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import {
  entityNodeId,
  relationNodeId,
  incidenceGraph,
  projectKnowledgeGraph,
  validateKnowledgeGraph,
  type KnowledgeGraphData,
  type KnowledgeSelection,
  type KnowledgeProjection,
  type KnowledgeRelation,
  type KnowledgeBadge,
} from './model.js';
import '@xyflow/react/dist/style.css';
import './graph.css';

export const defaultKnowledgeGraphLabels = {
  title: 'Knowledge map',
  search: 'Find an entity or relation',
  all: 'Whole map',
  list: 'Index',
  indexTitle: 'Objects and relations',
  openIndex: 'Expand graph index',
  closeIndex: 'Close graph index',
  collapseIndex: 'Collapse graph index',
  map: 'Map',
  empty: 'No objects to display.',
  invalid: 'The graph contains invalid identities or references.',
  budget: 'Choose an object to inspect its neighbourhood.',
  partial: 'Showing a neighbourhood',
  omitted: 'Relations outside the display budget',
  details: 'Selected object',
  inputs: 'Inputs',
  outputs: 'Outputs',
  fit: 'Fit to view',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  lock: 'Toggle interaction',
  hint: 'Select an object in the index or map. Dragging changes its position only.',
  clear: 'Clear selection',
  expand: 'Expand workspace',
  collapse: 'Close expanded workspace',
};
export type KnowledgeGraphLabels = typeof defaultKnowledgeGraphLabels;
type GraphNode = Node<
  {
    label: string;
    kind: string;
    selection: KnowledgeSelection;
    description?: string;
    badges?: readonly KnowledgeBadge[];
    inputs?: number;
    outputs?: number;
  },
  'knowledge'
>;
export interface KnowledgeGraphProps {
  data: KnowledgeGraphData;
  labels?: Partial<KnowledgeGraphLabels>;
  /** Bound visible DOM nodes, including relation nodes. Omitted relations are counted explicitly. */
  visibleBudget?: number;
  /** Optional independent persistence key for the graph index. */
  panelPersistKey?: string;
  onSelect?: (selection: KnowledgeSelection | undefined) => void;
  /** Only visual coordinates. No semantic operation is implied by a drag. */
  onLayoutChange?: (positions: Readonly<Record<string, XYPosition>>) => void;
  layout?: (projection: KnowledgeProjection) => Readonly<Record<string, XYPosition>>;
  renderDetails?: (selection: KnowledgeSelection) => ReactNode;
  height?: number;
  className?: string;
  sx?: SxProps<Theme>;
}
function Badges({ badges }: { badges?: readonly KnowledgeBadge[] }) {
  if (!badges?.length) return null;
  return (
    <Box component="span" sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
      {badges.map((badge, index) => (
        <Chip
          component="span"
          key={index}
          label={badge.label}
          size="small"
          variant="outlined"
          color={badge.tone ?? 'default'}
          sx={{ height: 'auto', minHeight: 24, '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 } }}
        />
      ))}
    </Box>
  );
}
const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<GraphNode>) {
  return (
    <div
      style={{ minHeight: Math.max(76, Math.max(data.inputs ?? 0, data.outputs ?? 0) * 24 + 24) }}
      className={`prism-knowledge__node ${data.selection.type === 'relation' ? 'prism-knowledge__relation' : ''} ${selected ? 'is-selected' : ''}`}
    >
      {data.selection.type === 'relation' ? (
        Array.from({ length: data.inputs ?? 0 }, (_, i) => (
          <Handle
            key={i}
            id={`inputs:${i}`}
            type="target"
            position={Position.Left}
            style={{ top: `${((i + 1) / ((data.inputs ?? 0) + 1)) * 100}%` }}
            isConnectable={false}
          />
        ))
      ) : (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      )}
      <span className="prism-knowledge__kind">{data.kind}</span>
      <strong>{data.label}</strong>
      <Badges badges={data.badges} />
      {data.selection.type === 'relation' ? (
        Array.from({ length: data.outputs ?? 0 }, (_, i) => (
          <Handle
            key={i}
            id={`outputs:${i}`}
            type="source"
            position={Position.Right}
            style={{ top: `${((i + 1) / ((data.outputs ?? 0) + 1)) * 100}%` }}
            isConnectable={false}
          />
        ))
      ) : (
        <Handle type="source" position={Position.Right} isConnectable={false} />
      )}
    </div>
  );
});
// Portal labels above the complete SVG edge layer. Otherwise a later path can
// cross through an earlier SVG label when a node grows after a status update.
function KnowledgeEdge(props: EdgeProps) {
  const [path, x, y] = getSmoothStepPath(props);
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        style={props.style}
        interactionWidth={props.interactionWidth}
      />
      {props.label != null && (
        <EdgeLabelRenderer>
          <Box
            component="span"
            aria-hidden="true"
            className="nodrag nopan"
            sx={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
              bgcolor: 'background.paper',
              color: 'text.primary',
              borderRadius: 0.5,
              px: 0.5,
              py: 0.25,
              fontSize: 12,
              lineHeight: 1.4,
              pointerEvents: 'none',
            }}
          >
            {props.label}
          </Box>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { knowledge: KnowledgeEdge };
const nodeTypes = { knowledge: EntityNode };
/** Deterministic initial grid, deliberately not a causal/topological ordering. Hosts may supply a layout algorithm. */
function defaultLayout(p: KnowledgeProjection): Record<string, XYPosition> {
  const positions: Record<string, XYPosition> = {};
  p.entities.forEach((e, i) => {
    positions[entityNodeId(e.id)] = { x: (i % 3) * 340, y: Math.floor(i / 3) * 170 };
  });
  p.relations.forEach((r, i) => {
    positions[relationNodeId(r.id)] = {
      x: (i % 3) * 340 + 170,
      y: Math.floor(p.entities.length / 3) * 170 + 180 + Math.floor(i / 3) * 150,
    };
  });
  return positions;
}
export function KnowledgeGraph({
  data,
  labels: overrides,
  visibleBudget = 300,
  panelPersistKey,
  onSelect,
  onLayoutChange,
  layout = defaultLayout,
  renderDetails,
  height = 560,
  className,
  sx,
}: KnowledgeGraphProps) {
  const theme = useTheme(),
    labels = useMemo(() => ({ ...defaultKnowledgeGraphLabels, ...overrides }), [overrides]);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState<KnowledgeSelection>(),
    [focus, setFocus] = useState<KnowledgeSelection>(),
    [view, setView] = useState<'map' | 'list'>('map');
  const valid = useMemo(() => {
    try {
      validateKnowledgeGraph(data);
      return true;
    } catch {
      return false;
    }
  }, [data]);
  const projection = useMemo(
    () =>
      valid
        ? projectKnowledgeGraph(data, focus, visibleBudget)
        : { entities: [], relations: [], total: 0, omittedRelations: 0, limited: false },
    [data, valid, focus, visibleBudget]
  );
  const graph = useMemo(() => incidenceGraph(projection), [projection]);
  const positions = useMemo(() => layout(projection), [layout, projection]);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  useEffect(() => {
    setNodes((old) => {
      const prior = new Map(old.map((n) => [n.id, n]));
      return graph.nodes.map((n) => ({
        id: n.id,
        type: 'knowledge',
        position: prior.get(n.id)?.position ?? positions[n.id] ?? { x: 0, y: 0 },
        data: n,
        selected: selected?.id === n.selection.id && selected.type === n.selection.type,
        ariaLabel: `${n.kind}: ${n.label}`,
        deletable: false,
      }));
    });
  }, [graph, positions, selected]);
  const edges = useMemo(
    () =>
      graph.edges.map((e) => ({
        ...e,
        type: 'knowledge',
        markerEnd: { type: MarkerType.ArrowClosed },
        focusable: true,
        ariaLabel: e.label,
        deletable: false,
      })),
    [graph]
  );
  const choose = useCallback(
    (s: KnowledgeSelection | undefined) => {
      setSelected(s);
      onSelect?.(s);
      if (projection.total > visibleBudget) setFocus(s);
    },
    [onSelect, projection.total, visibleBudget]
  );
  const onNodesChange = useCallback((changes: NodeChange<GraphNode>[]) => {
    setNodes((n) =>
      applyNodeChanges(
        changes.filter((c) => c.type !== 'remove'),
        n
      )
    );
  }, []);
  const index = useMemo(
    () =>
      [
        ...data.entities.map((e) => ({ ...e, selection: { type: 'entity' as const, id: e.id } })),
        ...data.relations.map((r) => ({ ...r, selection: { type: 'relation' as const, id: r.id } })),
      ].filter((e) =>
        `${e.label}\n${e.kind}\n${e.id}\n${e.badges?.map((b) => b.label).join(' ') ?? ''}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      ),
    [data, query]
  );
  const object =
    selected?.type === 'entity'
      ? data.entities.find((e) => e.id === selected.id)
      : data.relations.find((r) => r.id === selected?.id);
  useEffect(() => {
    if (selected && !object) {
      setSelected(undefined);
      setFocus(undefined);
      onSelect?.(undefined);
    }
  }, [selected, object, onSelect]);
  const graphIndex = (
    <Box className="prism-knowledge__index">
      <TextField
        fullWidth
        size="small"
        type="search"
        label={labels.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ mb: 2 }}
      />
      <ul className="prism-knowledge__results">
        {index.slice(0, visibleBudget).map((item) => (
          <li key={JSON.stringify(item.selection)}>
            <Button
              type="button"
              variant="text"
              aria-current={selected?.id === item.id && selected.type === item.selection.type}
              onClick={() => choose(item.selection)}
            >
              <span>{item.kind}</span>
              {item.label}
              <Badges badges={item.badges} />
            </Button>
          </li>
        ))}
      </ul>
      <small>
        {Math.min(index.length, visibleBudget)} / {index.length}
      </small>
      <Button
        type="button"
        onClick={() => {
          setFocus(undefined);
          choose(undefined);
        }}
      >
        {labels.clear}
      </Button>
    </Box>
  );
  const content = (
    <Box
      className={['prism-knowledge', view === 'list' && 'is-list', className].filter(Boolean).join(' ')}
      sx={[
        {
          '--prism-graph-border': theme.palette.divider,
          '--prism-graph-bg': theme.palette.background.paper,
          '--prism-graph-text': theme.palette.text.primary,
          '--prism-graph-muted': theme.palette.text.secondary,
          '--prism-graph-accent': theme.palette.primary.main,
          '--prism-graph-radius': `${theme.shape.borderRadius}px`,
          '--prism-graph-hover': theme.palette.action.hover,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <header className="prism-knowledge__header">
        <strong>{labels.title}</strong>
        <span>
          {projection.entities.length + projection.relations.length} / {projection.total}
        </span>
        <Button
          variant={view === 'map' ? 'contained' : 'outlined'}
          type="button"
          aria-pressed={view === 'map'}
          onClick={() => setView('map')}
        >
          {labels.map}
        </Button>
        <Button
          variant={view === 'list' ? 'contained' : 'outlined'}
          type="button"
          aria-pressed={view === 'list'}
          onClick={() => setView('list')}
        >
          {labels.list}
        </Button>
        <Button type="button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? labels.collapse : labels.expand}
        </Button>
      </header>
      {!valid ? (
        <p role="alert">{labels.invalid}</p>
      ) : (
        <>
          <p className="prism-knowledge__hint">{labels.hint}</p>
          {view === 'list' ? (
            graphIndex
          ) : (
            <PanelLayout
              title={labels.indexTitle}
              labels={{ expand: labels.openIndex, collapse: labels.collapseIndex, close: labels.closeIndex }}
              panel={({ collapsed }) => (
                <>
                  <Box hidden={collapsed}>{graphIndex}</Box>
                  {collapsed && (
                    <DocSidebar
                      compact
                      items={index.slice(0, visibleBudget).map((item) => ({
                        id: JSON.stringify(item.selection),
                        label: item.label,
                      }))}
                      activeId={selected && JSON.stringify(selected)}
                      onItemClick={(item) => {
                        const target = index.find((entry) => JSON.stringify(entry.selection) === item.id);
                        if (target) choose(target.selection);
                      }}
                    />
                  )}
                </>
              )}
              height={expanded ? '75dvh' : height}
              width={240}
              offset={88}
              persistKey={panelPersistKey}
              navigationKey={selected ? selected.type + ':' + selected.id : ''}
              sx={{ px: 1, pb: 1 }}
            >
              <div
                className="prism-knowledge__canvas"
                style={{ height: view === 'map' ? (expanded ? '75dvh' : height) : undefined }}
              >
                {view === 'map' && nodes.length > 0 ? (
                  <ReactFlow<GraphNode>
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onNodesChange={onNodesChange}
                    onNodeClick={(_e, n) => choose(n.data.selection)}
                    onNodeDragStop={(_e, node) =>
                      onLayoutChange?.(
                        Object.fromEntries(nodes.map((n) => [n.id, n.id === node.id ? node.position : n.position]))
                      )
                    }
                    onSelectionChange={({ nodes: chosen }) => {
                      const s = chosen[0]?.data.selection;
                      if (s && (s.id !== selected?.id || s.type !== selected?.type)) choose(s);
                    }}
                    nodesConnectable={false}
                    deleteKeyCode={null}
                    edgesReconnectable={false}
                    fitView
                    minZoom={0.1}
                    maxZoom={2}
                    onlyRenderVisibleElements
                    colorMode={theme.palette.mode}
                    ariaLabelConfig={{
                      'controls.zoomIn.ariaLabel': labels.zoomIn,
                      'controls.zoomOut.ariaLabel': labels.zoomOut,
                      'controls.fitView.ariaLabel': labels.fit,
                      'controls.interactive.ariaLabel': labels.lock,
                    }}
                  >
                    <Background gap={24} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                ) : (
                  <div className="prism-knowledge__empty">
                    {projection.total === 0 ? labels.empty : projection.limited ? labels.budget : labels.list}
                  </div>
                )}
              </div>
            </PanelLayout>
          )}
          {projection.limited && (
            <p className="prism-knowledge__hint" role="status">
              {labels.partial}: {projection.entities.length + projection.relations.length} / {projection.total}.{' '}
              {labels.omitted}: {projection.omittedRelations}.
            </p>
          )}
          {selected && object && (
            <section className="prism-knowledge__details" aria-label={labels.details}>
              <h3>{object.label}</h3>
              <p>{object.description}</p>
              {selected.type === 'relation' && (
                <div className="prism-knowledge__ports">
                  {(['inputs', 'outputs'] as const).map((side) => (
                    <div key={side}>
                      <strong>{labels[side]}</strong>
                      <ol>
                        {(object as KnowledgeRelation)[side].map((port, i) => (
                          <li key={i}>
                            {port.role}: {data.entities.find((e) => e.id === port.entity)?.label}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              )}
              {renderDetails?.(selected)}
            </section>
          )}
        </>
      )}
    </Box>
  );
  return expanded ? (
    <Dialog open fullScreen onClose={() => setExpanded(false)} aria-label={labels.title}>
      {content}
    </Dialog>
  ) : (
    content
  );
}
