/** Deployment topology: machines, declared dependencies, applications and ingress. */
import { useEffect, useCallback, useState, useRef } from 'react';
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
} from 'src/assets/icons';
import { InfraNode } from 'src/components/topology/infra-node';
import { AppNode } from 'src/components/topology/app-node';
import { GatewayNode } from 'src/components/topology/gateway-node';
import { ServerNode } from 'src/components/topology/server-node';
import { DetailPanel } from 'src/components/topology/detail-panel';
import { useTopologyStore, type AppNodeData, type TopologyNodeData } from 'src/components/topology/topology-store';
import { getStatusColor } from 'src/components/topology/shared-styles';
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
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: Node<TopologyNodeData> } | null>(null);
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();
  const duration = reducedMotion ? 0 : 200;

  useEffect(() => {
    setScope({ project: activeProject, stack: activeStack });
  }, [activeProject, activeStack, setScope]);
  useEffect(() => {
    setNodes((previous) =>
      storeNodes.map((node) => {
        const existing = previous.find((old) => old.id === node.id);
        return {
          ...node,
          position: existing?.position ?? node.position,
          selected: existing?.selected ?? false,
          ariaRole: 'button',
          ariaLabel: `${node.data.label}, ${node.data.nodeType}, ${node.data.status}. Inspect details`,
        };
      })
    );
  }, [storeNodes, setNodes]);
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
      openDetail(node.id, node.data.nodeType, node.data);
    },
    [openDetail]
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
    void fitView({ padding: 0.15, maxZoom: 1, duration });
  };
  // Refit on available-space changes, not on polling. A manual pan survives refreshes.
  useEffect(() => {
    const element = canvas.current;
    if (!element || listView || !nodes.length) return;
    let frame = 0;
    const fitAvailableSpace = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void fitView({
          ...(detailPanel.open && detailPanel.nodeId ? { nodes: [{ id: detailPanel.nodeId }] } : {}),
          padding: 0.15,
          maxZoom: 1,
          duration: 0,
        });
      });
    };
    const observer = new ResizeObserver(fitAvailableSpace);
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fitView, nodes.length, listView, detailPanel.open, detailPanel.nodeId]);

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
      action: () => zoomOut({ duration }),
      disabled: listView || zoom <= 0.1,
    },
    {
      label: 'Zoom in',
      icon: <ZoomInIcon fontSize="small" />,
      action: () => zoomIn({ duration }),
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
                void fitView({ nodes: [{ id: node.id }], maxZoom: 1, padding: 0.3, duration });
              }
            }}
          />
          <Stack direction="row" spacing={0.25} sx={{ flexWrap: 'wrap' }}>
            <Button size="small" aria-pressed={listView} onClick={() => setListView(!listView)}>
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
            <IconButton size="small" aria-label="Refresh topology" disabled={refreshing} onClick={refresh}>
              <RefreshIcon fontSize="small" />
            </IconButton>
            {!listView && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ minWidth: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(zoom * 100)}%
              </Typography>
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
            Select to inspect · + / − zoom · 0 fit
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
                void zoomIn({ duration });
              }
              if (event.key === '-') {
                event.preventDefault();
                void zoomOut({ duration });
              }
              if (event.key === '0') {
                event.preventDefault();
                fit();
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
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodeTypes={nodeTypes}
                    onNodeClick={(_, node) => inspect(node)}
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
                    fitView
                    fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
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
                        position="bottom-left"
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
