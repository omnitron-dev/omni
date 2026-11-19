import { workspaceHref, workspaceLocation, type Workspace } from './workspace';
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
  scope?: 'system' | 'project';
  stackFilter?: boolean;
}

/** The rail, command palette, route guard and stack picker share these destinations. */
const sections: { title: string; items: Destination[] }[] = [
  {
    title: 'Workspace',
    items: [
      { path: '/', title: 'Overview', icon: <DashboardIcon />, permission: 'OmnitronDaemon.status', stackFilter: true },
      { path: '/projects', scope: 'system', title: 'Projects', icon: <ProjectIcon />, permission: 'OmnitronProject.listProjects' },
      { path: '/studio', title: 'Agent Studio', icon: <TerminalIcon />, permission: 'OmnitronStudio.workspace', stackFilter: true },
      {
        path: '/stacks',
        title: 'Stacks',
        icon: <StacksIcon />,
        permission: 'OmnitronProject.listStacks',
        scope: 'project',
        stackFilter: true,
      },
      {
        path: '/apps',
        title: 'Applications',
        icon: <AppsIcon />,
        permission: 'OmnitronProject.getProjectApps',
        scope: 'project',
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
        stackFilter: true,
      },
      { path: '/flows', title: 'Flows', icon: <TopologyIcon />, permission: ['OmnitronFlows.list', 'OmnitronFlows.catalog'], stackFilter: true },
      { path: '/pipelines', title: 'Pipelines', icon: <PipelineIcon />, permission: 'OmnitronPipelines.listPipelines', stackFilter: true },
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
        stackFilter: true,
      },
      {
        path: '/traces',
        title: 'Traces',
        icon: <TraceIcon />,
        permission: 'OmnitronTraces.queryTraces',
        scope: 'system',
      },
      { path: '/alerts', scope: 'system', title: 'Alerts', icon: <AlertIcon />, permission: 'OmnitronAlerts.getRules' },
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
      { path: '/nodes', scope: 'system', title: 'Nodes', icon: <NodesIcon />, permission: 'OmnitronNodes.listNodes' },
      {
        path: '/containers',
        title: 'Containers',
        icon: <ContainersIcon />,
        permission: ['OmnitronInfra.listContainers', 'OmnitronProject.listStacks'],
        stackFilter: true,
      },
      { path: '/terminal', scope: 'system', title: 'SSH workspace', icon: <TerminalIcon />, permission: 'OmnitronTerminal.open' },
      { path: '/files', scope: 'system', title: 'Files', icon: <FolderIcon />, permission: 'OmnitronFiles.roots' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { path: '/access', scope: 'system', title: 'Access', icon: <AccessIcon />, permission: 'OmnitronAccess.describe' },
      { path: '/audit', scope: 'system', title: 'Audit', icon: <AuditIcon />, permission: 'OmnitronAudit.list' },
      { path: '/system', scope: 'system', title: 'System', icon: <SystemInfoIcon />, permission: 'OmnitronSystemInfo.getSnapshot' },
      { path: '/settings', scope: 'system', title: 'Settings', icon: <SettingsIcon /> },
    ],
  },
];

const byPath = new Map(sections.flatMap((section) => section.items.map((item) => [item.path, item] as const)));

export function consoleRoute(pathname: string, search = '') {
  const { pagePath, project, appDetail, stackDetail } = workspaceLocation({ pathname });
  const [page = '', detail] = pagePath.split('/').filter(Boolean);
  const process = page === 'processes' && !project && !!detail;
  const item = byPath.get('/' + page);
  const release = page === 'releases' && !!detail;
  const params = new URLSearchParams(search);
  const proposal = page === 'flows' && !!params.get('team') && !!params.get('proposal') && !params.has('flow') && !params.has('new');
  let permission = item?.permission;
  if (appDetail || process) permission = 'OmnitronDaemon.getApp';
  else if (release) permission = 'OmnitronRelease.get';
  else if (proposal) permission = 'OmnitronStudio.flowProposal';
  else if (page === 'flows' && params.get('flow')) permission = 'OmnitronFlows.get';
  return {
    permission,
    scope: item?.scope,
    stackFilter: Boolean(project && item?.stackFilter),
    appDetail, stackDetail,
  };
}

export function consoleNavigation(workspace: Workspace, can: (permission: RpcPermission) => boolean, pathname = '/', search = ''): LayoutNavData {
  const { project } = workspace;
  const current = workspaceLocation({ pathname });
  const detailGrant = consoleRoute(pathname, search).permission;
  return sections
    .map(({ title: sectionTitle, items }) => ({
      id: sectionTitle.toLowerCase(),
      subheader: sectionTitle,
      items: items
        .flatMap(({ title, path, icon, scope, permission }) => {
          if (scope === 'project' && !project || scope === 'system' && project) return [];
          const mayList = !permission || (Array.isArray(permission) ? permission.some(can) : can(permission));
          const selected = current.pagePath === path || path !== '/' && current.pagePath.startsWith(path + '/')
            || path === '/' && current.pagePath.startsWith('/processes/');
          const mayReadDetail = selected && typeof detailGrant === 'string' && can(detailGrant);
          if (!mayList && !mayReadDetail) return [];
          return [{ id: path.slice(1) || 'dashboard', title, icon, deepMatch: path !== '/',
            path: mayList ? workspaceHref(workspace, path) : pathname + search,
            ...(path === '/' && !project && { selectionPrefix: '/processes/' }),
          }];
        }),
    }))
    .filter((section) => section.items.length > 0);
}
