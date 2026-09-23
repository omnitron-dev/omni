/**
 * How the console addresses one deployment of an app.
 *
 * `getProjectApps` lists every deployment of every app with its stack — the
 * same `main` once for `dev` and once for `test`. The daemon knows a local
 * deployment by its handle, `daos/dev/main`; a remote stack's apps run on its
 * node, where this daemon has no handle for them at all.
 */

import type {
  AggregatedMetricsDto,
  AppDiagnosticsDto,
  IProjectAppStatus,
  ProcessInfoDto,
} from '@omnitron-dev/omnitron/dto/services';

/** Only a local stack's apps are this daemon's own: a detail page, start, stop. */
export const isLocal = (app: IProjectAppStatus): boolean => app.stackType === 'local';

/** The detail page of a local deployment, by the handle the daemon knows it by. */
export const detailHref = (app: IProjectAppStatus): string => `/apps/${encodeURIComponent(app.handleKey)}`;

/** One stack's deployments, or all of them when no stack is selected. */
export const deploymentsIn = (apps: IProjectAppStatus[], stack: string | null): IProjectAppStatus[] =>
  stack ? apps.filter((app) => app.stack === stack) : apps;

/**
 * The name to ask the daemon for, from the detail page's URL.
 *
 * A handle is asked for as it is. A bare name — a link from before handles —
 * is qualified with the selected stack; with all stacks selected there is
 * nothing to qualify it with, and the daemon resolves a short name only when
 * one app has it. This used to prepend `project/` alone, which names no app:
 * every detail page opened with all stacks selected answered «App with id
 * daos/main not found», four times a poll.
 */
export function daemonNameFor(name: string, project: string | null, stack: string | null): string {
  if (name.includes('/') || !project || !stack) return name;
  return `${project}/${stack}/${name}`;
}

/** Online and total among a list of apps. */
export const tally = (apps: ReadonlyArray<{ status: string }>) => ({
  appsOnline: apps.filter((app) => app.status === 'online').length,
  appsTotal: apps.length,
});

/**
 * The apps the status bar counts: the deployments of the selected project
 * and stack — the rows /apps lists — or, with no project selected, this
 * daemon's own. `null` when the selection could not be asked.
 *
 * It counted `daemon.status().apps` whatever was selected: this daemon's
 * processes, every project's. Beside «daos / test» it read «Apps 6/6» about
 * dev's six, while test's six run on a node it never asked — had they all
 * stopped, the bar would still have said 6/6.
 */
export function countedApps(
  project: string | null,
  stack: string | null,
  status: { apps?: ReadonlyArray<{ status: string }> } | null,
  deployments: PromiseSettledResult<IProjectAppStatus[] | null>,
): ReadonlyArray<{ status: string }> | null {
  if (!project) return status?.apps ?? [];
  return deployments.status === 'fulfilled' && deployments.value ? deploymentsIn(deployments.value, stack) : null;
}

/** One app as a page shows it for the selection. */
export interface ShownApp {
  /** Unique in the view: this daemon's handle for a local app, `stack/name` for a remote one. */
  key: string;
  name: string;
  /** The stack it belongs to; `null` for a process whose handle names none. */
  stack: string | null;
  /** Run by a node rather than by this daemon. */
  remote: boolean;
  status: ProcessInfoDto['status'];
  pid: number | null;
  uptime: number;
  cpu: number;
  memory: number;
  restarts: number;
  processes?: ProcessInfoDto['processes'];
}

/**
 * The apps a page shows for the selection. With a project, its deployments —
 * the rows /apps lists and the status bar counts — a local one with this
 * daemon's process details joined by handle, a remote one as its node
 * reports it; with no project, this daemon's processes. `null` while the
 * selected project has not been asked yet.
 *
 * The dashboard showed `daemon.list()` filtered by prefix: this machine's
 * processes only. Measured 2026-09-23 with daos selected, all stacks: it
 * counted and grouped dev's six and never test's six, beside its own
 * «Stacks 2/2».
 */
export function shownApps(
  project: string | null,
  stack: string | null,
  deployments: IProjectAppStatus[] | null,
  processes: ProcessInfoDto[],
): ShownApp[] | null {
  const facts = (app: IProjectAppStatus | ProcessInfoDto) => ({
    status: app.status,
    pid: app.pid,
    uptime: app.uptime,
    cpu: app.cpu,
    memory: app.memory,
    restarts: app.restarts,
  });
  if (!project) {
    return processes.map((process) => {
      const parts = process.name.split('/');
      return {
        ...facts(process),
        key: process.name,
        name: parts[parts.length - 1]!,
        stack: parts.length >= 3 ? parts[1]! : null,
        remote: false,
        ...(process.processes ? { processes: process.processes } : {}),
      };
    });
  }
  if (!deployments) return null;
  const byHandle = new Map(processes.map((process) => [process.name, process]));
  return deploymentsIn(deployments, stack).map((app) => {
    const own = isLocal(app) ? byHandle.get(app.handleKey) : undefined;
    return {
      ...facts(app),
      key: isLocal(app) ? app.handleKey : `${app.stack}/${app.name}`,
      name: app.name,
      stack: app.stack,
      remote: !isLocal(app),
      ...(own?.processes ? { processes: own.processes } : {}),
    };
  });
}

/**
 * The traffic the daemon counted for an app, or `null` when nobody counted.
 * `not-reported` — no server process, or a runtime that does not say — is not
 * zero requests, and neither is the answer of a daemon that predates the
 * field: its `requests: 0` was a default.
 */
export const countedTraffic = (
  entry: AggregatedMetricsDto['apps'][string] | null | undefined,
): AggregatedMetricsDto['apps'][string] | null => (entry?.traffic === 'measured' ? entry : null);

/**
 * The one process an app's diagnostics measured, when they measured one.
 *
 * Until 0e7726e7 `inspect` measured ONE process — the one whose pid the
 * daemon holds for the app. In an app of several that is one of them (main's
 * notification-worker, 181.9 MB of the app's 661.8 MB, measured 2026-09-23),
 * and the page labelled its figures as though they were the app's. Since
 * then its RSS is the app's, summed over every process, and the answer
 * carries `pools`, which older daemons do not send: naming one process
 * beside that figure would call the app's memory one process's — as «RSS of
 * http: 645.5 MB» did beside an app of 645.2 MB.
 */
export const measuredProcess = (
  app: Pick<ProcessInfoDto, 'processes'>,
  diagnostics: Pick<AppDiagnosticsDto, 'pid' | 'pools'> | null | undefined,
): NonNullable<ProcessInfoDto['processes']>[number] | undefined => {
  if (!diagnostics || Array.isArray(diagnostics.pools)) return undefined;
  return (app.processes?.length ?? 0) > 1 ? app.processes!.find((process) => process.pid === diagnostics.pid) : undefined;
};
