/**
 * The daemon's memory and its apps', read apart.
 *
 * `status().totalMemory` is both: every app's memory plus the daemon's own
 * RSS. The console showed it as the DAEMON's «Memory» on the dashboard
 * builder, and as the apps' figure beside «N app(s) · X% CPU» on a node's
 * card, where the CPU beside it was the apps' alone. Since 4042b647 the
 * daemon says each part (`daemonMemory`, `appsMemory`); a daemon on an older
 * build does not, and its total is still the sum of the two, so each part is
 * what the other leaves.
 */

import type { DaemonStatusDto } from '@omnitron-dev/omnitron/dto/services';

type Status = Pick<DaemonStatusDto, 'apps' | 'totalMemory' | 'daemonMemory' | 'appsMemory'>;

const summed = (status: Status) => status.apps.reduce((sum, app) => sum + app.memory, 0);

/** The apps' memory, bytes. */
export const appsMemoryOf = (status: Status): number => status.appsMemory ?? summed(status);

/** The daemon process's own RSS, bytes. */
export const daemonMemoryOf = (status: Status): number => status.daemonMemory ?? status.totalMemory - summed(status);
