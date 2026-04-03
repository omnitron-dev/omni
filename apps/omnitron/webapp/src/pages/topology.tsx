/**
 * Topology Page — Visual infrastructure topology editor.
 *
 * The centerpiece UI of the Omnitron Console. Renders a React Flow canvas
 * with custom nodes for infrastructure services, applications, gateways,
 * and fleet servers. Supports drag-to-rearrange, click-to-inspect, and
 * real-time auto-refresh.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useViewport,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeMouseHandler,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';

import {
  PlusIcon,
  RefreshIcon,
  NodesIcon,
  ServerIcon,
  RestartIcon,
  StopIcon,
  PlayIcon,
  LogsIcon,
  SearchIcon,
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
import { AddServerDialog } from 'src/components/topology/add-server-dialog';
import { useTopologyStore, type TopologyNodeData } from 'src/components/topology/topology-store';
import { useStackContext } from 'src/hooks/use-stack-context';
import { pulseKeyframes } from 'src/components/topology/shared-styles';

// ---------------------------------------------------------------------------
// Node type registry
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  infraNode: InfraNode as any,
  appNode: AppNode as any,
  gatewayNode: GatewayNode as any,
  serverNode: ServerNode as any,
};

// (Stack selector is now in the header — no inline environment dropdown needed)

// ---------------------------------------------------------------------------
// Toolbar controls (must be inside ReactFlow to use hooks)
// ---------------------------------------------------------------------------

const toolbarIconBtnSx = { color: '#94a3b8', '&:hover': { color: '#e2e8f0' } } as const;

function ToolbarControls({
  nodesLocked,
  onToggleLock,
  isFullscreen,
  onToggleFullscreen,
}: {
  nodesLocked: boolean;
  onToggleLock: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}) {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { zoom } = useViewport();
  const zoomPercent = Math.round(zoom * 100);

  return (
    <>
      {/* Zoom controls */}
      <Tooltip title="Zoom out (-)">
        <IconButton size="small" data-zoom-out onClick={() => zoomOut({ duration: 200 })} sx={toolbarIconBtnSx}>
          <ZoomOutIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      <Typography
        variant="caption"
        sx={{
          color: '#94a3b8',
          fontWeight: 600,
          fontSize: 11,
          minWidth: 36,
          textAlign: 'center',
          userSelect: 'none',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {zoomPercent}%
      </Typography>

      <Tooltip title="Zoom in (+)">
        <IconButton size="small" data-zoom-in onClick={() => zoomIn({ duration: 200 })} sx={toolbarIconBtnSx}>
          <ZoomInIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      {/* Auto-layout / fit view */}
      <Tooltip title="Fit view (0)">
        <IconButton
          size="small"
          data-fit-view
          onClick={() => fitView({ padding: 0.3, maxZoom: 1.2, duration: 400 })}
          sx={toolbarIconBtnSx}
        >
          <NodesIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>

      {/* Separator */}
      <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(255,255,255,0.08)' }} />

      {/* Lock toggle */}
      <Tooltip title={nodesLocked ? 'Unlock nodes' : 'Lock nodes'}>
        <IconButton size="small" onClick={onToggleLock} sx={toolbarIconBtnSx}>
          {nodesLocked ? <LockIcon sx={{ fontSize: 18 }} /> : <LockOpenIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Tooltip>

      {/* Fullscreen toggle */}
      <Tooltip title={isFullscreen ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)'}>
        <IconButton size="small" onClick={onToggleFullscreen} sx={toolbarIconBtnSx}>
          {isFullscreen ? (
            <FullscreenExitIcon sx={{ fontSize: 18 }} />
          ) : (
            <FullscreenIcon sx={{ fontSize: 18 }} />
          )}
        </IconButton>
      </Tooltip>
    </>
  );
}

// ---------------------------------------------------------------------------
// Topology Page
// ---------------------------------------------------------------------------

export default function TopologyPage() {
  const { namespacePrefix } = useStackContext();
  const {
    nodes: storeNodes,
    edges: storeEdges,
    loading,
    error,
    detailPanel,
    fetchAll,
    setFilterPrefix,
    openDetail,
    closeDetail,
    setNodes: setStoreNodes,
    setEdges: setStoreEdges,
    apps,
    daemonStatus,
  } = useTopologyStore();

  // Sync stack context → topology filter
  useEffect(() => {
    setFilterPrefix(namespacePrefix);
  }, [namespacePrefix, setFilterPrefix]);

  // React Flow local state (synced from store)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Dialog state
  const [addServerOpen, setAddServerOpen] = useState(false);

  // Lock / Fullscreen state
  const [nodesLocked, setNodesLocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    nodeId: string;
    nodeType: string;
    data: TopologyNodeData;
  } | null>(null);

  // Sync store nodes -> React Flow
  useEffect(() => {
    setNodes(storeNodes as Node[]);
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges(storeEdges as Edge[]);
  }, [storeEdges, setEdges]);

  // Persist position changes back to store
  const handleNodesChangeWrapped = useCallback(
    (changes: any) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  // Initial fetch + auto-refresh
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Toggle fullscreen on the canvas container
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  // Sync fullscreen state with browser events
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Toggle node lock
  const toggleNodesLocked = useCallback(() => {
    setNodesLocked((prev) => !prev);
  }, []);

  // Keyboard shortcuts (must be on window since ReactFlow canvas may not be focusable)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case '+':
        case '=':
          // Zoom in — dispatched to ReactFlow via store-independent DOM approach
          document.querySelector<HTMLButtonElement>('[data-zoom-in]')?.click();
          break;
        case '-':
          document.querySelector<HTMLButtonElement>('[data-zoom-out]')?.click();
          break;
        case '0':
          document.querySelector<HTMLButtonElement>('[data-fit-view]')?.click();
          break;
        case 'Escape':
          if (detailPanel.open) closeDetail();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [detailPanel.open, closeDetail]);

  // Node click -> open detail panel
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data;
      if (!data) return;
      const nodeType = (data as any).nodeType ?? 'app';
      openDetail(node.id, nodeType, data as TopologyNodeData);
    },
    [openDetail],
  );

  // Pane click -> close detail panel + context menu
  const handlePaneClick = useCallback(() => {
    if (detailPanel.open) closeDetail();
    if (contextMenu) setContextMenu(null);
  }, [detailPanel.open, closeDetail, contextMenu]);

  // Right-click -> context menu
  const handleNodeContextMenu: NodeMouseHandler = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      const data = node.data;
      if (!data) return;
      const nodeType = (data as any).nodeType ?? 'app';
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        nodeId: node.id,
        nodeType,
        data: data as TopologyNodeData,
      });
    },
    [],
  );

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { nodeType, data } = contextMenu;
      setContextMenu(null);

      if (nodeType === 'app') {
        const appData = data as any;
        switch (action) {
          case 'inspect':
            openDetail(contextMenu.nodeId, nodeType as any, data);
            break;
          case 'restart':
            useTopologyStore.getState().restartApp(appData.name);
            break;
          case 'stop':
            useTopologyStore.getState().stopApp(appData.name);
            break;
          case 'start':
            useTopologyStore.getState().startApp(appData.name);
            break;
          case 'logs':
            openDetail(contextMenu.nodeId, nodeType as any, data);
            // Switch to logs tab after panel opens
            break;
        }
      } else {
        // For non-app nodes, just open detail panel
        openDetail(contextMenu.nodeId, nodeType as any, data);
      }
    },
    [contextMenu, openDetail],
  );

  // Summary stats
  const onlineApps = apps.filter((a) => a.status === 'online').length;
  const totalApps = apps.length;

  return (
    <>
      {/* Inject pulse animation keyframes */}
      <style>{pulseKeyframes}</style>

      <Box
        ref={containerRef}
        sx={{
          display: 'flex',
          width: '100%',
          // Explicit height required — React Flow needs a sized container.
          // 64px header + 28px status bar + 64px padding = ~156px overhead
          height: 'calc(100vh - 156px)',
          minHeight: 400,
          overflow: 'hidden',
          bgcolor: '#0a0a0f',
          position: 'relative',
        }}
      >
        {/* Main canvas area */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            transition: 'margin-right 0.3s ease',
            mr: detailPanel.open ? '400px' : 0,
          }}
        >
          {/* Error snackbar */}
          <Snackbar
            open={!!error}
            autoHideDuration={6000}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          >
            <Alert severity="warning" variant="filled" sx={{ width: '100%' }}>
              {error}
            </Alert>
          </Snackbar>

          {/* Loading skeleton */}
          {loading && nodes.length === 0 ? (
            <Box sx={{ p: 4 }}>
              <Stack spacing={2}>
                <Skeleton variant="rectangular" height={50} sx={{ borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)' }} />
                <Stack direction="row" spacing={3}>
                  {[...Array(3)].map((_, i) => (
                    <Skeleton
                      key={i}
                      variant="rectangular"
                      width={280}
                      height={160}
                      sx={{ borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)' }}
                    />
                  ))}
                </Stack>
              </Stack>
            </Box>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChangeWrapped}
              onEdgesChange={onEdgesChange}
              onNodeClick={handleNodeClick}
              onNodeContextMenu={handleNodeContextMenu}
              onPaneClick={handlePaneClick}
              nodeTypes={nodeTypes}
              nodesDraggable={!nodesLocked}
              fitView
              fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              style={{ background: '#0a0a0f' }}
              defaultEdgeOptions={{
                type: 'smoothstep',
                style: { strokeWidth: 1.5 },
              }}
            >
              {/* Background dots */}
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="rgba(255,255,255,0.04)"
              />

              {/* Controls */}
              <Controls
                position="bottom-left"
                showInteractive={false}
                style={{
                  background: 'rgba(15, 15, 25, 0.9)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                }}
              />

              {/* MiniMap */}
              <MiniMap
                position="bottom-right"
                nodeColor={(node) => {
                  const data = node.data as any;
                  if (!data) return '#334155';
                  if (data.nodeType === 'infra') return '#336791';
                  if (data.nodeType === 'app') {
                    return data.status === 'online' ? '#22c55e' : data.status === 'stopped' ? '#6b7280' : '#ef4444';
                  }
                  if (data.nodeType === 'gateway') return '#3b82f6';
                  if (data.nodeType === 'server') return '#818cf8';
                  return '#334155';
                }}
                maskColor="rgba(10, 10, 15, 0.85)"
                style={{
                  background: 'rgba(15, 15, 25, 0.9)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                }}
              />

              {/* Top toolbar panel */}
              <Panel position="top-left">
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                  sx={{
                    bgcolor: 'rgba(15, 15, 25, 0.92)',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '10px',
                    px: 2,
                    py: 1,
                  }}
                >
                  {/* Title */}
                  <NodesIcon sx={{ color: '#818cf8', fontSize: 20 }} />
                  <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#e2e8f0', mr: 1 }}>
                    Topology
                  </Typography>

                  {/* Stack context shown via header StackSelector */}

                  {/* Separator */}
                  <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(255,255,255,0.08)' }} />

                  {/* Stats */}
                  <Chip
                    label={`${onlineApps}/${totalApps} apps online`}
                    size="small"
                    sx={{
                      height: 24,
                      fontSize: 11,
                      fontWeight: 600,
                      bgcolor: onlineApps === totalApps && totalApps > 0
                        ? 'rgba(34,197,94,0.12)'
                        : 'rgba(245,158,11,0.12)',
                      color: onlineApps === totalApps && totalApps > 0 ? '#22c55e' : '#f59e0b',
                      border: '1px solid',
                      borderColor: onlineApps === totalApps && totalApps > 0
                        ? 'rgba(34,197,94,0.3)'
                        : 'rgba(245,158,11,0.3)',
                    }}
                  />

                  {daemonStatus && (
                    <Chip
                      label={`v${daemonStatus.version}`}
                      size="small"
                      sx={{
                        height: 24,
                        fontSize: 11,
                        bgcolor: 'rgba(255,255,255,0.06)',
                        color: '#94a3b8',
                      }}
                    />
                  )}

                  {/* Separator */}
                  <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(255,255,255,0.08)' }} />

                  {/* Zoom / Lock / Fullscreen controls */}
                  <ToolbarControls
                    nodesLocked={nodesLocked}
                    onToggleLock={toggleNodesLocked}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                  />

                  {/* Separator */}
                  <Box sx={{ width: 1, height: 20, bgcolor: 'rgba(255,255,255,0.08)' }} />

                  {/* Refresh */}
                  <Tooltip title="Refresh topology">
                    <IconButton
                      size="small"
                      onClick={fetchAll}
                      sx={toolbarIconBtnSx}
                    >
                      <RefreshIcon />
                    </IconButton>
                  </Tooltip>

                  {/* Add Server */}
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<ServerIcon />}
                    onClick={() => setAddServerOpen(true)}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 600,
                      fontSize: 12,
                      height: 32,
                      color: '#e2e8f0',
                      borderColor: 'rgba(255,255,255,0.15)',
                      '&:hover': {
                        borderColor: 'rgba(255,255,255,0.3)',
                        bgcolor: 'rgba(255,255,255,0.04)',
                      },
                    }}
                  >
                    Add Server
                  </Button>
                </Stack>
              </Panel>

              {/* Empty state overlay */}
              {!loading && nodes.length === 0 && (
                <Panel position="top-center">
                  <Box
                    sx={{
                      mt: 12,
                      textAlign: 'center',
                      bgcolor: 'rgba(15, 15, 25, 0.92)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      px: 4,
                      py: 3,
                    }}
                  >
                    <NodesIcon sx={{ fontSize: 48, color: '#334155', mb: 1 }} />
                    <Typography variant="h6" sx={{ color: '#94a3b8', mb: 0.5 }}>
                      No topology data
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#475569', mb: 2 }}>
                      Start the daemon and deploy applications to see your infrastructure topology.
                    </Typography>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={fetchAll}
                      startIcon={<RefreshIcon />}
                      sx={{
                        textTransform: 'none',
                        color: '#818cf8',
                        borderColor: 'rgba(129, 140, 248, 0.3)',
                      }}
                    >
                      Retry
                    </Button>
                  </Box>
                </Panel>
              )}
            </ReactFlow>
          )}
        </Box>

        {/* Detail panel */}
        <DetailPanel />

        {/* Context Menu */}
        <Menu
          open={contextMenu !== null}
          onClose={handleContextMenuClose}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined
          }
          slotProps={{
            paper: {
              sx: {
                bgcolor: 'rgba(15, 15, 25, 0.95)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#e2e8f0',
                minWidth: 180,
                '& .MuiMenuItem-root': {
                  fontSize: 13,
                  py: 0.75,
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                },
                '& .MuiListItemIcon-root': {
                  minWidth: 32,
                  color: '#94a3b8',
                },
              },
            },
          }}
        >
          <MenuItem onClick={() => handleContextMenuAction('inspect')}>
            <ListItemIcon><SearchIcon sx={{ fontSize: 18 }} /></ListItemIcon>
            <ListItemText>Inspect</ListItemText>
          </MenuItem>

          {contextMenu?.nodeType === 'app' && [
            <Divider key="div-1" sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />,

            (contextMenu.data as any).status === 'online' ? (
              <MenuItem key="restart" onClick={() => handleContextMenuAction('restart')}>
                <ListItemIcon><RestartIcon sx={{ fontSize: 18 }} /></ListItemIcon>
                <ListItemText>Restart</ListItemText>
              </MenuItem>
            ) : null,

            (contextMenu.data as any).status === 'online' ? (
              <MenuItem key="stop" onClick={() => handleContextMenuAction('stop')}>
                <ListItemIcon><StopIcon sx={{ fontSize: 18, color: '#ef4444' }} /></ListItemIcon>
                <ListItemText sx={{ '& .MuiTypography-root': { color: '#ef4444' } }}>Stop</ListItemText>
              </MenuItem>
            ) : null,

            (contextMenu.data as any).status !== 'online' ? (
              <MenuItem key="start" onClick={() => handleContextMenuAction('start')}>
                <ListItemIcon><PlayIcon sx={{ fontSize: 18, color: '#22c55e' }} /></ListItemIcon>
                <ListItemText sx={{ '& .MuiTypography-root': { color: '#22c55e' } }}>Start</ListItemText>
              </MenuItem>
            ) : null,

            <Divider key="div-2" sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />,

            <MenuItem key="logs" onClick={() => handleContextMenuAction('logs')}>
              <ListItemIcon><LogsIcon sx={{ fontSize: 18 }} /></ListItemIcon>
              <ListItemText>View Logs</ListItemText>
            </MenuItem>,
          ]}
        </Menu>

        {/* Add server dialog */}
        <AddServerDialog open={addServerOpen} onClose={() => setAddServerOpen(false)} />
      </Box>
    </>
  );
}
