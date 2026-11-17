import type { ReactNode } from 'react';
import type { LayoutNavData } from '@omnitron-dev/prism/layouts';
import type { RpcPermission } from 'src/auth/access';
import {
  AccessIcon,
  AlertIcon,
  AppsIcon,
  AuditIcon,
  ContainersIcon,
  DashboardBuilderIcon,
  DashboardIcon,
  DeployIcon,
  FolderIcon,
  LogsIcon,
  MetricsIcon,
  NodesIcon,
  PipelineIcon,
  ProjectIcon,
  ReleaseIcon,
  SettingsIcon,
  StacksIcon,
  SystemInfoIcon,
  TerminalIcon,
  TopologyIcon,
  TraceIcon,
} from 'src/assets/icons';

export type PagePermission = RpcPermission | [RpcPermission, ...RpcPermission[]];

interface Destination {
  path: string;
  title: string;
  icon: ReactNode;
  permission?: PagePermission;
  requiresProject?: boolean;
  stackFilter?: boolean;
}

/** The rail, command palette, route guard and stack picker share these destinations. */
const sections: { title: string; items: Destination[] }[] = [
  {
    title: 'Workspace',
    items: [
      { path: '/', title: 'Overview', icon: <DashboardIcon />, permission: 'OmnitronDaemon.status', stackFilter: true },
      { path: '/projects', title: 'Projects', icon: <ProjectIcon />, permission: 'OmnitronProject.listProjects' },
      {
        path: '/stacks',
        title: 'Stacks',
        icon: <StacksIcon />,
        permission: 'OmnitronProject.listStacks',
        requiresProject: true,
        stackFilter: true,
      },
      {
        path: '/apps',
        title: 'Applications',
        icon: <AppsIcon />,
        permission: 'OmnitronProject.getProjectApps',
        requiresProject: true,
        stackFilter: true,
      },
    ],
  },
  {
    title: 'Delivery',
    items: [
      {
        path: '/releases',
        title: 'Releases',
        icon: <ReleaseIcon />,
        permission: 'OmnitronRelease.list',
        stackFilter: true,
      },
      {
        path: '/deployments',
        title: 'Deployments',
        icon: <DeployIcon />,
        permission: ['OmnitronProject.getDeployProgress', 'OmnitronRelease.deployments', 'OmnitronDeploy.getHistory'],
        requiresProject: true,
        stackFilter: true,
      },
      { path: '/pipelines', title: 'Pipelines', icon: <PipelineIcon />, permission: 'OmnitronPipelines.listPipelines' },
    ],
  },
  {
    title: 'Observability',
    items: [
      { path: '/logs', title: 'Logs', icon: <LogsIcon />, permission: 'OmnitronLogs.queryLogs', stackFilter: true },
      {
        path: '/metrics',
        title: 'Metrics',
        icon: <MetricsIcon />,
        permission: 'OmnitronMetrics.getSnapshot',
        requiresProject: true,
        stackFilter: true,
      },
      {
        path: '/traces',
        title: 'Traces',
        icon: <TraceIcon />,
        permission: 'OmnitronTraces.queryTraces',
        requiresProject: true,
      },
      { path: '/alerts', title: 'Alerts', icon: <AlertIcon />, permission: 'OmnitronAlerts.getRules' },
      {
        path: '/dashboard-builder',
        title: 'Dashboard Builder',
        icon: <DashboardBuilderIcon />,
        permission: [
          'OmnitronDaemon.status',
          'OmnitronProject.getProjectApps',
          'OmnitronMetrics.querySeries',
          'OmnitronAlerts.getSummary',
        ],
        stackFilter: true,
      },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      {
        path: '/topology',
        title: 'Topology',
        icon: <TopologyIcon />,
        permission: 'OmnitronNodes.listNodes',
        stackFilter: true,
      },
      { path: '/nodes', title: 'Nodes', icon: <NodesIcon />, permission: 'OmnitronNodes.listNodes' },
      {
        path: '/containers',
        title: 'Containers',
        icon: <ContainersIcon />,
        permission: ['OmnitronInfra.listContainers', 'OmnitronProject.listStacks'],
        stackFilter: true,
      },
      { path: '/terminal', title: 'SSH workspace', icon: <TerminalIcon />, permission: 'OmnitronTerminal.open' },
      { path: '/files', title: 'Files', icon: <FolderIcon />, permission: 'OmnitronFiles.roots' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { path: '/access', title: 'Access', icon: <AccessIcon />, permission: 'OmnitronAccess.describe' },
      { path: '/audit', title: 'Audit', icon: <AuditIcon />, permission: 'OmnitronAudit.list' },
      { path: '/system', title: 'System', icon: <SystemInfoIcon />, permission: 'OmnitronSystemInfo.getSnapshot' },
      { path: '/settings', title: 'Settings', icon: <SettingsIcon /> },
    ],
  },
];

const byPath = new Map(sections.flatMap((section) => section.items.map((item) => [item.path, item] as const)));

export function consoleRoute(pathname: string) {
  const [page = '', detail, ...rest] = pathname.split('/').filter(Boolean);
  const item = byPath.get('/' + page);
  const appDetail = page === 'apps' && Boolean(detail) && rest.length === 0;
  const stackDetail = page === 'stacks' && Boolean(detail) && rest.length === 0;
  return {
    permission: appDetail ? ('OmnitronDaemon.getApp' as const) : item?.permission,
    requiresProject: Boolean(item?.requiresProject && !appDetail),
    stackFilter: Boolean(item?.stackFilter && (!detail || stackDetail)),
    stackDetail,
  };
}

export function consoleNavigation(hasProject: boolean, can: (permission: RpcPermission) => boolean): LayoutNavData {
  return sections
    .map(({ title: sectionTitle, items }) => ({
      id: sectionTitle.toLowerCase(),
      subheader: sectionTitle,
      items: items
        .filter((item) => {
          if (item.requiresProject && !hasProject) return false;
          const grant = item.permission;
          return !grant || (Array.isArray(grant) ? grant.some(can) : can(grant));
        })
        .map(({ title, path, icon }) => ({
          id: path.slice(1) || 'dashboard',
          title,
          path,
          icon,
          ...(path !== '/' && { selectionPrefix: path }),
        })),
    }))
    .filter((section) => section.items.length > 0);
}
