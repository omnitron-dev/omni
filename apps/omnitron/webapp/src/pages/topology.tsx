/** Deployment topology: machines, declared dependencies, applications and ingress. */
import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Autocomplete,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  RefreshIcon,
  NodesIcon,
  ZoomInIcon,
  ZoomOutIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  LockIcon,
  LockOpenIcon,
  DashboardIcon,
} from 'src/assets/icons';
import { InfraNode } from 'src/components/topology/infra-node';
import { AppNode } from 'src/components/topology/app-node';
import { GatewayNode } from 'src/components/topology/gateway-node';
import { ServerNode } from 'src/components/topology/server-node';
import { DetailPanel } from 'src/components/topology/detail-panel';
import {
  useTopologyStore,
  serviceState,
  type AppNodeData,
  type TopologyNodeData,
} from 'src/components/topology/topology-store';
import { getStatusColor } from 'src/components/topology/shared-styles';
import {
  arrangeTopologyNodes,
  nearestTopologyNode,
  readableTopologyViewport,
  topologyColumns,
  TOPOLOGY_CARD_HEIGHT,
  TOPOLOGY_GAP,
} from 'src/components/topology/topology-layout';
import { useStackContext } from 'src/hooks/use-stack-context';
import { usePollingEffect } from 'src/hooks/use-polled-resource';
import { useAccess } from 'src/auth/access';
import { Alert } from '@omnitron-dev/prism/components/alert';
import { Skeleton } from '@omnitron-dev/prism/components/skeleton';
import { Breadcrumbs } from 'src/components/page-breadcrumbs';

const nodeTypes: NodeTypes = {
  infraNode: InfraNode,
  appNode: AppNode,
  gatewayNode: GatewayNode,
  serverNode: ServerNode,
};

export default function TopologyPage() {
  const { activeProject, activeStack } = useStackContext();
  return (
    <ReactFlowProvider key={JSON.stringify([activeProject, activeStack])}>
      <TopologyWorkspace />
    </ReactFlowProvider>
  );
}

function TopologyWorkspace() {
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const { can } = useAccess();
  const navigate = useNavigate();
  const { activeProject, activeStack } = useStackContext();
  const {
    nodes: storeNodes,
    edges: storeEdges,
    loading,
    error,
    detailPanel,
    fetchAll,
    setScope,
    openDetail,
    closeDetail,
    apps,
  } = useTopologyStore();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TopologyNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [locked, setLocked] = useState(true);
  const [listView, setListView] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [manualLayout, setManualLayout] = useState(false);
  const [layoutReset, setLayoutReset] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: Node<TopologyNodeData> } | null>(null);
  const { fitView, zoomIn, zoomOut, getNodes, getViewport, setViewport } = useReactFlow();
  const { zoom } = useViewport();
  const nodesInitialized = useNodesInitialized();
  const viewMode = useRef<'readable' | 'overview' | 'manual'>('readable');
  const viewFocus = useRef<string | null>(null);
  const previousSize = useRef<typeof canvasSize | null>(null);
  const previousGeometry = useRef<Pick<Node, 'id' | 'position'>[]>([]);
  const columns = topologyColumns(canvasSize.width);
  const arrangedNodes = useMemo(() => arrangeTopologyNodes(storeNodes, columns), [storeNodes, columns]);
  const layoutKey = arrangedNodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}`).join('|');
  const duration = reducedMotion ? 0 : 200;

  useEffect(() => {
    setScope({ project: activeProject, stack: activeStack });
  }, [activeProject, activeStack, setScope]);
  useEffect(() => {
    setNodes((previous) => {
      let nextY = Math.max(0, ...previous.map((node) => node.position.y + TOPOLOGY_CARD_HEIGHT + TOPOLOGY_GAP));
      return arrangedNodes.map((node) => {
        const existing = previous.find((old) => old.id === node.id);
        let position = node.position;
        if (manualLayout) {
          position = existing?.position ?? { x: 0, y: nextY };
          if (!existing) nextY += TOPOLOGY_CARD_HEIGHT + TOPOLOGY_GAP;
        }
        return {
          ...existing,
          ...node,
          position,
          sourcePosition: manualLayout && existing ? existing.sourcePosition : node.sourcePosition,
          targetPosition: manualLayout && existing ? existing.targetPosition : node.targetPosition,
          selected: existing?.selected ?? false,
          ariaRole: 'button',
          ariaLabel: `${node.data.label}, ${node.data.nodeType}, ${node.data.nodeType === 'infra' || node.data.nodeType === 'gateway' ? serviceState(node.data) : node.data.status}. Inspect details`,
        };
      });
    });
  }, [arrangedNodes, manualLayout, setNodes]);
  useEffect(() => {
    setEdges(storeEdges);
  }, [storeEdges, setEdges]);
  usePollingEffect(
    () => {
      void fetchAll();
    },
    { intervalMs: 5_000 }
  );
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const inspect = useCallback(
    (node: Node<TopologyNodeData>) => {
      viewFocus.current = node.id;
      viewMode.current = 'manual';
      setNodes((previous) => previous.map((item) => ({ ...item, selected: item.id === node.id })));
      openDetail(node.id, node.data.nodeType, node.data);
    },
    [openDetail, setNodes]
  );
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current?.requestFullscreen();
      setViewError(null);
    } catch {
      setViewError('Fullscreen is unavailable in this browser. The graph remains usable in this window.');
    }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  };
  const fit = () => {
    viewMode.current = 'overview';
    viewFocus.current = null;
    void fitView({ padding: 0.08, minZoom: 0.1, maxZoom: 1, duration });
  };
  const readable = () => {
    viewMode.current = 'readable';
    void setViewport(readableTopologyViewport(getNodes(), canvasSize, detailPanel.nodeId ?? viewFocus.current), {
      duration,
    });
  };
  const changeZoom = (direction: 'in' | 'out') => {
    viewMode.current = 'manual';
    viewFocus.current = null;
    void (direction === 'in' ? zoomIn({ duration }) : zoomOut({ duration }));
  };
  // Measure the actual canvas, including the space reserved by a persistent inspector.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setCanvasSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Polling changes readings, not the camera. Only geometry, selection or an explicit command reframes it.
  useEffect(() => {
    if (!nodesInitialized || listView || !canvasSize.width || !canvasSize.height) return undefined;
    const frame = requestAnimationFrame(() => {
      const oldSize = previousSize.current;
      const oldNodes = previousGeometry.current;
      const currentNodes = getNodes();
      previousSize.current = canvasSize;
      previousGeometry.current = currentNodes.map(({ id, position }) => ({ id, position: { ...position } }));
      const focusId = detailPanel.open ? detailPanel.nodeId : viewFocus.current;
      if (focusId) {
        void setViewport(readableTopologyViewport(getNodes(), canvasSize, focusId));
      } else if (viewMode.current === 'overview') {
        void fitView({ padding: 0.08, minZoom: 0.1, maxZoom: 1, duration: 0 });
      } else if (viewMode.current === 'manual' && oldSize) {
        const current = getViewport();
        const oldPositions = new Map(oldNodes.map((node) => [node.id, node.position]));
        const reflowed = currentNodes.some((node) => {
          const old = oldPositions.get(node.id);
          return old && (old.x !== node.position.x || old.y !== node.position.y);
        });
        if (reflowed) {
          const anchor = nearestTopologyNode(oldNodes, oldSize, current);
          void setViewport(readableTopologyViewport(currentNodes, canvasSize, anchor));
        } else {
          void setViewport({
            ...current,
            x: current.x + (canvasSize.width - oldSize.width) / 2,
            y: current.y + (canvasSize.height - oldSize.height) / 2,
          });
        }
      } else {
        void setViewport(readableTopologyViewport(getNodes(), canvasSize));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    nodesInitialized,
    listView,
    canvasSize,
    layoutKey,
    layoutReset,
    detailPanel.open,
    detailPanel.nodeId,
    fitView,
    getNodes,
    getViewport,
    setViewport,
  ]);

  const menuApp = menu?.node.data.nodeType === 'app' ? (menu.node.data as AppNodeData) : null;
  const localApp = menuApp && !menuApp.remote ? menuApp : null;
  const act = (action: 'start' | 'stop' | 'restart') => {
    if (!localApp) return;
    const name = localApp.name;
    setMenu(null);
    void useTopologyStore.getState()[`${action}App`](name);
  };
  const controls = [
    {
      label: 'Zoom out',
      icon: <ZoomOutIcon fontSize="small" />,
      action: () => changeZoom('out'),
      disabled: listView || zoom <= 0.1,
    },
    {
      label: 'Zoom in',
      icon: <ZoomInIcon fontSize="small" />,
      action: () => changeZoom('in'),
      disabled: listView || zoom >= 2,
    },
    { label: 'Fit graph', icon: <NodesIcon fontSize="small" />, action: fit, disabled: listView || !nodes.length },
    {
      label: locked ? 'Unlock node positions' : 'Lock node positions',
      icon: locked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />,
      action: () => setLocked(!locked),
      disabled: listView,
    },
    {
      label: fullscreen ? 'Exit fullscreen' : 'Fullscreen',
      icon: fullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />,
      action: toggleFullscreen,
    },
  ];

  return (
    <Stack spacing={1} sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
      <Breadcrumbs
        heading="Topology"
        links={[{ name: 'Infrastructure', href: '/nodes' }, { name: 'Topology' }]}
        action={
          <Button component={RouterLink} to="/nodes" size="small">
            Nodes
          </Button>
        }
      />
      <Box
        ref={container}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          bgcolor: 'background.default',
        }}
      >
        <Stack
          direction="row"
          useFlexGap
          spacing={1}
          sx={{
            flexWrap: 'wrap',
            alignItems: 'center',
            p: 1,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          }}
        >
          <Autocomplete
            options={nodes}
            value={null}
            size="small"
            getOptionLabel={(node) => `${node.data.label} · ${node.data.nodeType}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            sx={{ flex: '1 1 180px', minWidth: 0 }}
            renderInput={(params) => <TextField {...params} label="Find node" />}
            onChange={(_, node) => {
              if (node) {
                inspect(node);
                void setViewport(readableTopologyViewport(getNodes(), canvasSize, node.id), { duration });
              }
            }}
          />
          <Stack direction="row" useFlexGap spacing={0.25} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="small" sx={{ minWidth: 0 }} aria-pressed={listView} onClick={() => setListView(!listView)}>
              {listView ? 'Graph' : 'List'}
            </Button>
            {controls.map((control) => (
              <Tooltip key={control.label} title={control.label} describeChild>
                <span>
                  <IconButton
                    size="small"
                    aria-label={control.label}
                    disabled={control.disabled}
                    onClick={control.action}
                  >
                    {control.icon}
                  </IconButton>
                </span>
              </Tooltip>
            ))}
            {manualLayout && (
              <Tooltip title="Arrange nodes" describeChild>
                <IconButton
                  size="small"
                  aria-label="Arrange nodes"
                  disabled={listView}
                  onClick={() => {
                    viewMode.current = 'readable';
                    viewFocus.current = null;
                    setManualLayout(false);
                    setLayoutReset((value) => value + 1);
                  }}
                >
                  <DashboardIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <IconButton size="small" aria-label="Refresh topology" disabled={refreshing} onClick={refresh}>
              <RefreshIcon fontSize="small" />
            </IconButton>
            {!listView && (
              <Tooltip title="Readable view (1)" describeChild>
                <Button
                  size="small"
                  aria-label="Readable view"
                  onClick={readable}
                  sx={{ minWidth: 40, px: 0.5, fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(zoom * 100)}%
                </Button>
              </Tooltip>
            )}
          </Stack>
        </Stack>
        {(error || viewError) && (
          <Alert severity={error && !nodes.length ? 'error' : 'warning'} variant="outlined" sx={{ mt: 1 }}>
            {error || viewError}
          </Alert>
        )}
        <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', px: 1, py: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            {apps.filter((app) => app.status === 'online').length}/{apps.length} apps online · {nodes.length} nodes ·{' '}
            {edges.length} declared links
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: { xs: 'none', sm: 'block' }, ml: 'auto' }}
          >
            Scroll to pan · + / − zoom · 0 fit · 1 readable
          </Typography>
        </Stack>
        <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          <Box
            ref={canvas}
            tabIndex={0}
            role="region"
            aria-label="Deployment topology"
            onKeyDownCapture={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              const target = event.target as HTMLElement;
              const element = target.closest('.react-flow__node');
              if (target !== element) return;
              const node = nodes.find((item) => item.id === element?.getAttribute('data-id'));
              if (node) {
                event.preventDefault();
                event.stopPropagation();
                inspect(node);
              }
            }}
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              position: 'relative',
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
            }}
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
              )
                return;
              if (listView) return;
              if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                changeZoom('in');
              }
              if (event.key === '-') {
                event.preventDefault();
                changeZoom('out');
              }
              if (event.key === '0') {
                event.preventDefault();
                fit();
              }
              if (event.key === '1') {
                event.preventDefault();
                readable();
              }
              if (
                event.target === event.currentTarget &&
                ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
              ) {
                event.preventDefault();
                viewMode.current = 'manual';
                viewFocus.current = null;
                const current = getViewport();
                const dx = event.key === 'ArrowLeft' ? 80 : event.key === 'ArrowRight' ? -80 : 0;
                const dy = event.key === 'ArrowUp' ? 80 : event.key === 'ArrowDown' ? -80 : 0;
                void setViewport({ ...current, x: current.x + dx, y: current.y + dy });
              }
            }}
          >
            {loading && !nodes.length ? (
              <Skeleton variant="rectangular" height="100%" />
            ) : !nodes.length ? (
              <Stack sx={{ height: '100%', p: 2, alignItems: 'center', justifyContent: 'center' }} spacing={1}>
                <Typography variant="body2">
                  {error ? 'Topology unavailable' : 'No deployments in this selection'}
                </Typography>
                <Button onClick={refresh}>Refresh</Button>
              </Stack>
            ) : (
              <>
                <Box sx={{ height: '100%', display: listView ? 'none' : 'block' }}>
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={(changes) => {
                      if (changes.some((change) => change.type === 'position' && change.position)) {
                        viewMode.current = 'manual';
                        viewFocus.current = null;
                        setManualLayout(true);
                      }
                      onNodesChange(changes);
                    }}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    onNodeClick={(_, node) => inspect(node)}
                    onNodeDragStart={() => {
                      viewMode.current = 'manual';
                      viewFocus.current = null;
                      setManualLayout(true);
                    }}
                    onMoveStart={(event) => {
                      if (event) {
                        viewMode.current = 'manual';
                        viewFocus.current = null;
                      }
                    }}
                    onPaneClick={closeDetail}
                    onNodeContextMenu={(event, node) => {
                      event.preventDefault();
                      setMenu({ x: event.clientX, y: event.clientY, node });
                    }}
                    nodesDraggable={!locked}
                    nodesConnectable={false}
                    edgesFocusable={false}
                    deleteKeyCode={null}
                    ariaLabelConfig={{
                      'node.a11yDescription.default': 'Press Enter or Space to inspect this node.',
                      'node.a11yDescription.keyboardDisabled': 'Press Enter or Space to inspect this node.',
                    }}
                    panOnScroll
                    panOnScrollSpeed={1}
                    zoomOnScroll={false}
                    zoomActivationKeyCode={['Meta', 'Control']}
                    minZoom={0.1}
                    maxZoom={2}
                    colorMode={theme.palette.mode}
                    proOptions={{ hideAttribution: true }}
                    style={{ background: 'transparent' }}
                  >
                    <Background
                      bgColor="transparent"
                      variant={BackgroundVariant.Dots}
                      gap={24}
                      size={1}
                      color={theme.palette.divider}
                    />
                    {wide && (
                      <MiniMap
                        ariaLabel="Topology overview"
                        position="bottom-right"
                        pannable
                        zoomable
                        style={{
                          width: 140,
                          height: 90,
                          background: theme.palette.background.paper,
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 8,
                        }}
                        nodeColor={(node) => getStatusColor(String(node.data?.status ?? 'unknown'), theme)}
                        maskColor={alpha(theme.palette.background.default, 0.75)}
                      />
                    )}
                  </ReactFlow>
                </Box>
                {listView && (
                  <List aria-label="Topology nodes" sx={{ height: '100%', overflow: 'auto', p: 0 }}>
                    {nodes.map((node) => (
                      <ListItemButton
                        key={node.id}
                        selected={detailPanel.nodeId === node.id}
                        onClick={() => inspect(node)}
                        sx={{ gap: 1 }}
                      >
                        <Box
                          sx={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            flexShrink: 0,
                            bgcolor: getStatusColor(node.data.status, theme),
                          }}
                        />
                        <ListItemText
                          primary={node.data.label}
                          secondary={`${node.data.nodeType} · ${node.data.status}`}
                          slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                )}
              </>
            )}
          </Box>
          <DetailPanel container={fullscreen ? container.current : undefined} />
        </Box>
        <Menu
          open={!!menu}
          onClose={() => setMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={menu ? { left: menu.x, top: menu.y } : undefined}
          container={fullscreen ? container.current : undefined}
          slotProps={{ list: { 'aria-label': 'Node actions' } }}
        >
          <MenuItem
            onClick={() => {
              if (menu) inspect(menu.node);
              setMenu(null);
            }}
          >
            Inspect
          </MenuItem>
          {localApp && <Divider />}
          {localApp &&
            (localApp.status === 'online' ? (
              [
                <MenuItem key="restart" disabled={!can('OmnitronDaemon.restartApp')} onClick={() => act('restart')}>
                  Restart
                </MenuItem>,
                <MenuItem
                  key="stop"
                  disabled={!can('OmnitronDaemon.stopApp')}
                  onClick={() => act('stop')}
                  sx={{ color: 'error.main' }}
                >
                  Stop
                </MenuItem>,
              ]
            ) : (
              <MenuItem disabled={!can('OmnitronDaemon.startApp')} onClick={() => act('start')}>
                Start
              </MenuItem>
            ))}
          {localApp && (
            <MenuItem
              onClick={() => {
                navigate(`/logs?app=${encodeURIComponent(localApp.name)}`);
                setMenu(null);
              }}
            >
              View logs
            </MenuItem>
          )}
        </Menu>
      </Box>
    </Stack>
  );
}
