/**
 * `omnitron audit` — who changed this control plane, and what they changed.
 *
 * The table has existed since the first migration and nothing wrote to it,
 * so there was nothing to read and no command to read it with.
 */

import { log, table, prism } from '@xec-sh/kit';

import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronAuditService } from '../shared/dto/services.js';

export interface AuditListOptions {
  limit?: number;
  action?: string;
  resource?: string;
  actor?: string;
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

export async function auditListCommand(options: AuditListOptions = {}): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IOmnitronAuditService>('OmnitronAudit');

    const { available } = await svc.available();
    if (!available) {
      // A daemon with no omnitron database records nothing, and an empty
      // list would read as "nothing has happened".
      log.warn('This daemon has no audit trail — it has no omnitron database to record into.');
      return;
    }

    const rows = await svc.list({
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.action ? { action: options.action } : {}),
      ...(options.resource ? { resourceType: options.resource } : {}),
      ...(options.actor ? { actorId: options.actor } : {}),
    });

    if (rows.length === 0) {
      log.info('Nothing recorded yet for that query.');
      return;
    }

    table({
      width: 'auto',
      data: rows.map((r) => ({
        when: formatWhen(r.createdAt),
        action: r.action,
        resource: r.resourceId ? `${r.resourceType}:${r.resourceId}` : r.resourceType,
        actor: r.actorId ?? prism.dim(r.actorType),
        from: r.ipAddress ?? '-',
      })),
      columns: [
        { key: 'when', header: 'WHEN' },
        { key: 'action', header: 'ACTION' },
        { key: 'resource', header: 'RESOURCE' },
        { key: 'actor', header: 'ACTOR' },
        { key: 'from', header: 'FROM' },
      ],
    });
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
