import type { StackHealthObservation } from './dto/project.js';

export function healthLabel(status: StackHealthObservation['status'] = 'unknown') {
  return status === 'not-running' ? 'Not running' : status === 'unknown' ? 'Health unknown' :
    status === 'healthy' ? 'Healthy' : status === 'degraded' ? 'Health warning' : 'Unhealthy';
}

export function stackHealthReading(health?: StackHealthObservation) {
  const status = health?.status ?? 'unknown';
  const counts = new Map<string, number>();
  for (const app of health?.apps ?? []) counts.set(app.status, (counts.get(app.status) ?? 0) + 1);
  const detail = [...counts].map(([state, count]) => `${count} ${state === 'degraded' ? 'warning' : state}`).join(' · ');
  return { status, label: healthLabel(status),
    detail: detail || 'Application health has not been observed',
    findings: (health?.apps ?? []).filter(app => app.status !== 'healthy' && app.status !== 'not-running') };
}
