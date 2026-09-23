/**
 * How the console addresses one deployment of an app.
 *
 * `getProjectApps` lists every deployment of every app with its stack — the
 * same `main` once for `dev` and once for `test`. The daemon knows a local
 * deployment by its handle, `daos/dev/main`; a remote stack's apps run on its
 * node, where this daemon has no handle for them at all.
 */

import type { IProjectAppStatus } from '@omnitron-dev/omnitron/dto/services';

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
