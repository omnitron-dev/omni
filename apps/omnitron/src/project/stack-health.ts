import type { IStackInfo, StackHealthObservation } from '../shared/dto/project.js';

export type HealthAnswers = Record<string, { status: string; checks: Array<{ name: string; status: string; message?: string }> } | null>;

/** Exact deployment identities only. Failed reads and missing measurements remain unknown. */
export function observeStackHealth(info: IStackInfo, sources: Map<string, HealthAnswers | null>, observedAt: string): IStackInfo {
  const placements = info.type === 'local'
    ? info.apps.map(app => ({ name: app.name, node: 'local', process: { name: app.handleKey, status: app.status } }))
    : (info.placements ?? []).flatMap(node => node.apps.filter(app => app.expected || app.process)
      .map(app => ({ name: app.name, node: node.nodeKey,
        process: node.appsObserved ? app.process ?? { name: '', status: 'stopped' } : null })));
  const apps: StackHealthObservation['apps'] = placements.map(({ name, node, process }) => {
    const answer = process ? sources.get(node)?.[process.name] : null;
    if (process && process.status !== 'online') return { name, node, status: 'not-running', checks: [] };
    if (!answer || !['healthy', 'degraded', 'unhealthy'].includes(answer.status)) return { name, node, status: 'unknown',
      checks: [{ name: 'health', status: 'warn', message: 'Application health was not observed; process liveness is not readiness.' }] };
    return { name, node, status: answer.status as 'healthy' | 'degraded' | 'unhealthy', checks: answer.checks };
  });
  const status = summarizeHealth(apps.map(app => app.status));
  return { ...info,
    apps: info.apps.map(app => ({ ...app, health: summarizeHealth(apps.filter(sample => sample.name === app.name).map(sample => sample.status)) })),
    health: { status, observedAt: sources.size && [...sources.values()].some(Boolean) ? observedAt : null, apps } };
}

function summarizeHealth(statuses: StackHealthObservation['status'][]): StackHealthObservation['status'] {
  return !statuses.length ? 'unknown' : statuses.every(s => s === 'not-running') ? 'not-running'
    : statuses.includes('unhealthy') || statuses.includes('not-running') ? 'unhealthy'
    : statuses.includes('degraded') ? 'degraded' : statuses.includes('unknown') ? 'unknown' : 'healthy';
}
