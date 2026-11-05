import { useAccess } from 'src/auth/access';
import { daemon, alerts, metrics, project, nodes } from 'src/netron/client';
import { useStackContext } from './use-stack-context';
import { usePolledResource, type PolledResource } from './use-polled-resource';
import type { PollState } from 'src/utils/poll-runner';
import { shownApps } from 'src/utils/app-address';
import { METRIC_WINDOWS, metricScope } from 'src/utils/metric-series';
import type { DashboardConfig } from 'src/utils/dashboard-layout';
import type { ChartData, DashboardSources } from 'src/components/dashboard-panels';

function reading<T>(resource: PollState<T>, granted: boolean): PollState<T> {
  return granted
    ? resource
    : { data: null, loading: false, error: 'This session has no permission to read this source.' };
}

/** Subscribe once per data source, regardless of how many panels display it. */
export function useDashboardSources(board: DashboardConfig, live: boolean) {
  const { can } = useAccess();
  const { activeProject, activeStack, namespacePrefix } = useStackContext();
  const canStatus = can('OmnitronDaemon.status');
  const canApps = activeProject ? can('OmnitronProject.getProjectApps') : canStatus;
  const canAlerts = can('OmnitronAlerts.getSummary');
  const canNodes = can('OmnitronNodes.listNodes');
  const canHistory =
    can('OmnitronMetrics.querySeries') && (!activeProject || (can('OmnitronProject.listStacks') && canNodes));
  const needHistory = board.panels.some((p) => p.type === 'cpu-chart' || p.type === 'memory-chart');
  const needAlerts = board.panels.some((p) => p.type === 'alert-summary');
  const needApps = board.panels.some(
    (p) => p.type === 'app-grid' || p.type === 'recent-errors' || (p.type === 'stat' && p.config.metric !== 'uptime')
  );
  const needStatus =
    (!activeProject && needApps) ||
    board.panels.some((p) => p.type === 'daemon-info' || (p.type === 'stat' && p.config.metric === 'uptime'));
  const subject = activeProject ? [activeProject, activeStack].filter(Boolean).join(' / ') : 'Connected daemon';
  const scopeKey = JSON.stringify([activeProject, activeStack]);
  const intervalMs = board.refreshInterval;
  const status = usePolledResource(() => daemon.status(), {
    intervalMs,
    paused: !live,
    enabled: needStatus && canStatus,
    resourceKey: Number(canStatus),
  });
  const inventory = usePolledResource(
    async () => {
      const rows = await project.getProjectApps({ project: activeProject! });
      return shownApps(activeProject, activeStack, rows, [])!;
    },
    {
      intervalMs,
      paused: !live,
      enabled: Boolean(activeProject) && needApps && canApps,
      resourceKey: JSON.stringify([scopeKey, canApps]),
    }
  );
  const alert = usePolledResource(() => alerts.getSummary(), {
    intervalMs,
    paused: !live,
    enabled: needAlerts && canAlerts,
    resourceKey: Number(canAlerts),
  });
  const history = usePolledResource<ChartData>(
    async () => {
      const period = METRIC_WINDOWS[board.window];
      const to = Date.now(),
        from = to - period.duration;
      const [series, stacks, registry] = await Promise.all([
        metrics.querySeries({
          names: ['cpu_percent', 'memory_bytes'],
          from,
          to,
          interval: period.interval,
          limit: 120,
        }),
        activeProject ? project.listStacks({ project: activeProject }) : [],
        activeProject ? nodes.listNodes() : [],
      ]);
      return {
        series: activeProject ? series : series.filter((row) => !row.labels?.['node']),
        names: Object.fromEntries(registry.map((node) => [node.id, node.name])),
        scope: activeProject ? metricScope(activeProject, activeStack, stacks, registry) : undefined,
        from,
        to,
      };
    },
    {
      intervalMs,
      paused: !live,
      enabled: needHistory && canHistory,
      resourceKey: JSON.stringify([scopeKey, board.window, canHistory]),
    }
  );
  const apps = activeProject
    ? inventory
    : { ...status, data: status.data ? shownApps(null, null, null, status.data.apps) : null };
  const sources: DashboardSources = {
    subject,
    prefix: namespacePrefix,
    apps: reading(apps, canApps),
    status: reading(status, canStatus),
    alerts: reading(alert, canAlerts),
    history: reading(history, canHistory),
  };
  const refresh = () => {
    const requests: Array<Promise<void>> = [];
    const read = (needed: boolean, resource: Pick<PolledResource<unknown>, 'refresh'>) => {
      if (needed) requests.push(resource.refresh());
    };
    read(needHistory && canHistory, history);
    read(needAlerts && canAlerts, alert);
    read(needStatus && canStatus, status);
    read(Boolean(activeProject) && needApps && canApps, inventory);
    return Promise.all(requests);
  };
  return { sources, refresh };
}
