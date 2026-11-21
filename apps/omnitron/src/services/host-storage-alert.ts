import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { uuidV5 } from '../cluster/mesh-link.js';
import { STORAGE_ALERT_RULE } from '../database/migrations/018_host_storage_alert.js';
import type { OmnitronDatabase } from '../database/schema.js';
import { storageDecision, type StorageObservation, type StorageSubject } from '../monitoring/host-storage.js';
import type { SyncService } from './sync.service.js';

export const STORAGE_ALERT_FORMAT = 'host-storage@1';
/** The origin evaluates and delivers its alerts. The master's copies are visible in Alerts under the authenticated node. */
export const localAlert = sql<boolean>`"alert_events"."originNode" IS NULL AND NOT "alert_events"."legacyOrigin"`;

interface StorageEvent {
  format: typeof STORAGE_ALERT_FORMAT;
  eventId: string;
  revision: number;
  status: 'firing' | 'resolved';
  value: string;
  firedAt: string;
  resolvedAt: string | null;
}
interface StoredEvidence {
  subjects: StorageSubject[];
  revision: number;
}

export async function reconcileStorageAlert(
  db: Kysely<OmnitronDatabase>,
  rule: Selectable<OmnitronDatabase['alert_rules']>,
  observation: StorageObservation,
  now: number,
  held: (firing: boolean) => boolean,
  sync?: Pick<SyncService, 'bufferBatch'>
) {
  return db.transaction().execute(async (trx) => {
    // Serialize the read and mutation on both dialects, including overlapping generations during daemon handoff.
    const locked = await trx
      .updateTable('alert_rules')
      .set({ lastEvaluatedAt: new Date(now) })
      .where('id', '=', rule.id)
      .where('enabled', '=', true)
      .where('expression', '=', rule.expression)
      .executeTakeFirst();
    if (!Number(locked.numUpdatedRows)) return undefined;
    const current = await trx
      .selectFrom('alert_events')
      .selectAll()
      .where('ruleId', '=', rule.id)
      .where('status', '=', 'firing')
      .where(localAlert)
      .executeTakeFirst();
    const annotations =
      typeof current?.annotations === 'string' ? JSON.parse(current.annotations) : current?.annotations;
    const prior: StoredEvidence | undefined = annotations?.storage;
    if (
      current &&
      (!prior || !Number.isSafeInteger(prior.revision) || !Array.isArray(prior.subjects) || !prior.subjects.length)
    ) {
      throw Error('Storage alert has no retained fault evidence to reconcile');
    }
    const decision = storageDecision(observation, prior?.subjects ?? []);
    if (!current && !held(decision.firing)) return undefined;
    const status = decision.firing ? 'firing' : 'resolved';
    const value = decision.firing ? decision.value : decision.restored.join(' · ');
    if (current && decision.firing && value === current.value && isDeepStrictEqual(decision.subjects, prior!.subjects))
      return undefined;
    const revision = (prior?.revision ?? 0) + 1;
    const eventId = current?.id ?? randomUUID();
    const firedAt = current ? new Date(current.firedAt).toISOString() : new Date(now).toISOString();
    const resolvedAt = decision.firing ? null : new Date(now).toISOString();
    const template = typeof rule.annotations === 'string' ? JSON.parse(rule.annotations) : rule.annotations;
    const evidence = JSON.stringify({
      ...template,
      storage: {
        subjects: decision.firing ? decision.subjects : prior!.subjects,
        revision,
        ...(!decision.firing && { lastFault: current!.value }),
      },
    });
    if (current)
      await trx
        .updateTable('alert_events')
        .set({ status, value, annotations: evidence, resolvedAt })
        .where('id', '=', eventId)
        .execute();
    else
      await trx
        .insertInto('alert_events')
        .values({ id: eventId, ruleId: rule.id, status, value, annotations: evidence, firedAt })
        .execute();
    if (sync && rule.id === STORAGE_ALERT_RULE.id) {
      const entry: StorageEvent = {
        format: STORAGE_ALERT_FORMAT,
        eventId,
        revision,
        status,
        value,
        firedAt,
        resolvedAt,
      };
      await sync.bufferBatch([{ category: 'alerts', payload: { ...entry } }], trx);
    }
    return !current || !decision.firing ? { status, value } as const : undefined;
  });
}

/** A revision of one source event. A delayed firing or replay can never re-open a resolved copy. */
export async function projectStorageAlert(
  db: Transaction<OmnitronDatabase>,
  node: string,
  payload: Record<string, unknown>
) {
  const { eventId, revision, status, value, firedAt, resolvedAt } = payload;
  const time = (v: unknown): v is string =>
    typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
  if (
    typeof eventId !== 'string' ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(eventId) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof value !== 'string' ||
    !time(firedAt) ||
    (status !== 'firing' && status !== 'resolved') ||
    (status === 'firing' ? resolvedAt !== null : !time(resolvedAt))
  ) {
    throw Object.assign(Error('Invalid replicated storage alert evidence'), { code: '22023' });
  }
  const id = uuidV5(STORAGE_ALERT_RULE.id, JSON.stringify([node, eventId]));
  const annotations = JSON.stringify({ node, storageRevision: revision });
  const end = typeof resolvedAt === 'string' ? resolvedAt : null;
  await db
    .insertInto('alert_events')
    .values({
      id,
      originNode: node,
      ruleId: STORAGE_ALERT_RULE.id,
      status,
      value,
      firedAt,
      resolvedAt: end,
      annotations,
    })
    .onConflict((oc) =>
      oc
        .column('id')
        .doUpdateSet({ status, value, annotations, resolvedAt: end })
        .where('alert_events.status', '=', 'firing')
        .where('alert_events.originNode', '=', node)
        .where(sql<boolean>`cast(alert_events.annotations ->> 'storageRevision' as bigint) < ${revision}`)
    )
    .execute();
}
