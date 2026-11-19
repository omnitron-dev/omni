import { createHash, randomUUID } from 'node:crypto';
import { stableJson as canonical } from '../shared/canonical-json.js';
import { meshSourceIds } from './mesh-disk.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import {
  compileFlow,
  defaultFlowRegistry,
  validateFlow,
  validateFlowEvent,
  type FlowData,
  type FlowDefinition,
  type FlowEffect,
  type FlowEvent,
  type FlowState,
} from '../shared/dto/flows.js';
import type {
  FlowActivation,
  FlowChange,
  FlowDelivery,
  FlowList,
  FlowPage,
  FlowNotificationPage,
  FlowReceipt,
  FlowRef,
  FlowSave,
  FlowWorkspace,
  SavedFlow,
} from '../shared/dto/flow-runtime.js';

type Database = ReturnType<DaemonStateStore['initSync']>;
export interface FlowAuthority {
  actor: string;
  session: string | null;
}
export interface FlowBinding {
  identity: string;
  target: { project: string; stack: string; type: string } | null;
  mesh?: Record<string, string>;
}
interface Stored {
  id: string;
  project: string;
  stack: string;
  definition: string;
  revision: string;
  updated: number;
  active: string | null;
  session: string | null;
  binding: string | null;
  state: string;
}
interface EventRow {
  activation: string;
  event_id: string;
  revision: string;
  event: string;
  at: number;
  visited: string;
  traversed: string;
  state: string;
}
interface OutboxRow {
  id: string;
  flow_id: string;
  activation: string;
  event_id: string;
  kind: FlowEffect['kind'];
  node: string;
  title: string;
  effect: string;
  status: FlowDelivery['status'] | 'dispatching';
  retry_session: string | null;
  attempt: number;
  result: string | null;
  error: string | null;
}
export interface DiskSource {
  flow_id: string;
  activation: string;
  node: string;
  path: string;
  interval_ms: number;
  due: number;
}
export const isFlowId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
export function checkFlowWorkspace(workspace: FlowWorkspace) {
  const name = (v: unknown) =>
    typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= 160 && !v.includes('\0');
  if (
    !workspace ||
    (workspace.project !== null && !name(workspace.project)) ||
    (workspace.stack !== undefined && (workspace.project === null || !name(workspace.stack)))
  )
    throw Error('Select a flow workspace');
}
const workspaceOf = (row: Pick<Stored, 'project' | 'stack'>): FlowWorkspace => ({
  project: row.project || null,
  ...(row.stack && { stack: row.stack }),
});
const activeOf = (row: Stored): FlowActivation | null =>
  row.active ? (JSON.parse(row.active) as FlowActivation) : null;
type DeliverySummary = Pick<OutboxRow, 'id' | 'kind' | 'node' | 'title' | 'status' | 'result' | 'error'>;
const publicDelivery = (row: DeliverySummary): FlowDelivery => ({
  id: row.id,
  nodeId: row.node,
  kind: row.kind,
  title: row.title,
  status: row.status === 'dispatching' ? 'pending' : row.status,
  result: row.result,
  error: row.error,
});

/** State transitions, notifications and intents for other services commit in one local transaction. */
export class FlowLedger {
  private readonly compiled = new Map<
    string,
    { activation: string; revision: string; evaluate: ReturnType<typeof compileFlow> }
  >();
  constructor(
    private readonly db: Database,
    readonly registry = defaultFlowRegistry,
    private readonly now: () => number = Date.now
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS flow_definitions (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, stack TEXT NOT NULL, definition TEXT NOT NULL, revision TEXT NOT NULL,
        updated INTEGER NOT NULL, active TEXT, session TEXT, binding TEXT, state TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS flow_project_page ON flow_definitions(project,updated DESC,id,stack,json_extract(definition,'$.name'),active IS NOT NULL);
      CREATE INDEX IF NOT EXISTS flow_stack_page ON flow_definitions(project,stack,updated DESC,id,json_extract(definition,'$.name'),active IS NOT NULL);
      DROP INDEX IF EXISTS flow_workspace;
      CREATE TABLE IF NOT EXISTS flow_sources (
        flow_id TEXT NOT NULL, activation TEXT NOT NULL, node TEXT NOT NULL, path TEXT NOT NULL,
        interval_ms INTEGER NOT NULL, due INTEGER NOT NULL, error TEXT, PRIMARY KEY(flow_id,node)
      );
      CREATE INDEX IF NOT EXISTS flow_source_due ON flow_sources(due);
      CREATE TABLE IF NOT EXISTS flow_events (
        flow_id TEXT NOT NULL, activation TEXT NOT NULL, event_id TEXT NOT NULL, revision TEXT NOT NULL,
        event TEXT NOT NULL, at INTEGER NOT NULL, visited TEXT NOT NULL, traversed TEXT NOT NULL, state TEXT NOT NULL, sample_only INTEGER NOT NULL,
        UNIQUE(flow_id,activation,event_id)
      );
      CREATE INDEX IF NOT EXISTS flow_history ON flow_events(flow_id,at);
      CREATE INDEX IF NOT EXISTS flow_sample_history ON flow_events(flow_id,sample_only);
      CREATE TABLE IF NOT EXISTS flow_deliveries (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, flow_id TEXT NOT NULL, activation TEXT NOT NULL, event_id TEXT NOT NULL,
        node TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, effect TEXT NOT NULL,
        status TEXT NOT NULL, result TEXT, error TEXT, retry_session TEXT, attempt INTEGER NOT NULL DEFAULT 0,
        UNIQUE(flow_id,activation,event_id,node)
      );
      CREATE INDEX IF NOT EXISTS flow_delivery_status ON flow_deliveries(status);
      CREATE INDEX IF NOT EXISTS flow_notification_seq ON flow_deliveries(kind,sequence);
    `);
    db.transaction(() => {
      const columns = db.prepare("SELECT name FROM pragma_table_info('flow_deliveries')").all() as { name: string }[];
      if (!columns.some((c) => c.name === 'retry_session'))
        db.exec('ALTER TABLE flow_deliveries ADD COLUMN retry_session TEXT');
      if (!columns.some((c) => c.name === 'attempt'))
        db.exec('ALTER TABLE flow_deliveries ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0');
    }).immediate();
  }

  private byId(id: string): Stored | undefined {
    if (!isFlowId(id)) throw Error('Invalid flow ID');
    return this.db.prepare('SELECT * FROM flow_definitions WHERE id=?').get(id) as Stored | undefined;
  }
  private revision(definition: FlowDefinition, binding: FlowBinding) {
    validateFlow(definition, this.registry);
    if (meshSourceIds(definition).some((id) => !binding.mesh?.[id]))
      throw Error('The flow requires a reviewed mesh node');
    return createHash('sha256')
      .update(canonical({ definition, binding, components: this.registry.dependencies(definition) }))
      .digest('hex');
  }
  private commit<T>(work: () => T): T {
    if (this.db.inTransaction) throw Error('Flow state is busy');
    const previous = this.db.pragma('synchronous', { simple: true });
    try {
      this.db.pragma('synchronous=FULL');
      return this.db.transaction(work).immediate();
    } finally {
      this.db.pragma('synchronous=' + String(previous));
    }
  }
  verifyActivation(id: string, activation: string) {
    const row = this.byId(id),
      active = row && activeOf(row);
    if (!row || !active || active.id !== activation) throw Error('Flow activation changed');
    const compiled = this.compiled.get(id);
    if (compiled?.activation !== activation || compiled.revision !== active.revision) {
      if (this.revision(active.definition, JSON.parse(row.binding!) as FlowBinding) !== active.revision)
        throw Error('Installed flow components changed. Save and activate a reviewed revision.');
      this.compiled.set(id, {
        activation,
        revision: active.revision,
        evaluate: compileFlow(active.definition, this.registry),
      });
    }
    return {
      workspace: workspaceOf(row),
      binding: JSON.parse(row.binding!) as FlowBinding,
      definition: active.definition,
    };
  }
  private scoped(ref: FlowRef, includeProjectStacks = false): Stored {
    checkFlowWorkspace(ref.workspace);
    const row = this.byId(ref.id);
    const entireProject = includeProjectStacks && ref.workspace.stack === undefined;
    if (
      !row ||
      row.project !== (ref.workspace.project ?? '') ||
      (!entireProject && row.stack !== (ref.workspace.stack ?? ''))
    )
      throw Error('Flow not found in this workspace');
    return row;
  }
  private saved(row: Stored): SavedFlow {
    const sources = this.db
      .prepare('SELECT node AS nodeId,due AS dueAt,error FROM flow_sources WHERE flow_id=? ORDER BY node')
      .all(row.id) as SavedFlow['sources'];
    return {
      id: row.id,
      workspace: workspaceOf(row),
      revision: row.revision,
      definition: JSON.parse(row.definition),
      active: activeOf(row),
      updatedAt: row.updated,
      sources,
    };
  }
  list({ workspace, limit = 25, before }: FlowList): FlowPage {
    checkFlowWorkspace(workspace);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Error('Select between 1 and 100 flows');
    if (
      before !== undefined &&
      (!before || !isFlowId(before.id) || !Number.isSafeInteger(before.updatedAt) || before.updatedAt < 0)
    )
      throw Error('Invalid flow list cursor');
    const scope = [workspace.project ?? ''];
    if (workspace.stack !== undefined) scope.push(workspace.stack);
    const select =
      "SELECT id,project,stack,updated,json_extract(definition,'$.name') AS name, active IS NOT NULL AS active " +
      'FROM flow_definitions WHERE project=?' +
      (workspace.stack === undefined ? '' : ' AND stack=?');
    // Separate index ranges also start at the cursor when thousands of saves share a timestamp.
    const query = before ? select + ' AND updated=? AND id>? UNION ALL ' + select + ' AND updated<?' : select;
    const args = before ? [...scope, before.updatedAt, before.id, ...scope, before.updatedAt] : scope;
    const rows = this.db.prepare(query + ' ORDER BY updated DESC,id LIMIT ?').all(...args, limit + 1) as (Pick<
      Stored,
      'id' | 'project' | 'stack' | 'updated'
    > & { name: string; active: number })[];
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      workspace: workspaceOf(row),
      updatedAt: row.updated,
      name: row.name,
      active: Boolean(row.active),
    }));
    const last = items.at(-1);
    return { items, next: last && rows.length > limit ? { updatedAt: last.updatedAt, id: last.id } : null };
  }
  get(ref: FlowRef, { includeProjectStacks = false } = {}) {
    return this.saved(this.scoped(ref, includeProjectStacks));
  }
  save(data: FlowSave, binding: FlowBinding): SavedFlow {
    checkFlowWorkspace(data.workspace);
    const revision = this.revision(data.definition, binding);
    const body = canonical(data.definition);
    return this.commit(() => {
      const previous = this.byId(data.id);
      if (previous) {
        this.scoped(data);
        if (previous.revision === revision) return this.saved(previous);
        if (previous.revision !== data.expectedRevision)
          throw Error('The flow draft changed. Reload it before saving.');
        this.db
          .prepare('UPDATE flow_definitions SET definition=?,revision=?,updated=? WHERE id=?')
          .run(body, revision, this.now(), data.id);
      } else {
        if (data.expectedRevision !== null) throw Error('The original flow draft is unavailable');
        this.db
          .prepare('INSERT INTO flow_definitions(id,project,stack,definition,revision,updated) VALUES(?,?,?,?,?,?)')
          .run(data.id, data.workspace.project ?? '', data.workspace.stack ?? '', body, revision, this.now());
      }
      return this.saved(this.scoped(data));
    });
  }
  change(data: FlowChange, authority: FlowAuthority, binding: FlowBinding | null): SavedFlow {
    return this.commit(() => {
      const enabled = binding !== null;
      const row = this.scoped(data);
      const previous = activeOf(row);
      if (data.revision !== row.revision || (previous?.id ?? null) !== data.activation)
        throw Error('The draft or running revision changed. Review it again.');
      const definition: FlowDefinition = JSON.parse(row.definition);
      if (enabled && this.revision(definition, binding) !== row.revision)
        throw Error('Flow components or the registered workspace changed. Save the draft before activating it.');
      if (enabled && previous?.revision === row.revision) {
        if (row.binding !== canonical(binding))
          throw Error('The active workspace registration changed. Pause and review this flow.');
        return this.saved(row);
      }
      if (!enabled && !previous) return this.saved(row);
      const active: FlowActivation | null = enabled
        ? { id: randomUUID(), revision: row.revision, definition, actor: authority.actor, startedAt: this.now() }
        : null;
      this.db.prepare('DELETE FROM flow_sources WHERE flow_id=?').run(row.id);
      this.compiled.delete(row.id);
      this.db
        .prepare(
          "UPDATE flow_deliveries SET status='needs-review',retry_session=NULL,error='Activation ended' WHERE flow_id=? AND status='pending'"
        )
        .run(row.id);
      this.db
        .prepare(
          "UPDATE flow_deliveries SET status='unconfirmed',retry_session=NULL,result=id,error='Activation ended during delivery. Inspect the original command.' WHERE flow_id=? AND status='dispatching'"
        )
        .run(row.id);
      this.db
        .prepare("UPDATE flow_definitions SET active=?,session=?,binding=?,state='{}',updated=? WHERE id=?")
        .run(
          active ? JSON.stringify(active) : null,
          active ? authority.session : null,
          active ? canonical(binding) : null,
          this.now(),
          row.id
        );
      if (active)
        for (const node of definition.nodes.filter((n) => n.type === 'host.disk@1' || n.type === 'mesh.disk@1')) {
          this.db
            .prepare('INSERT INTO flow_sources(flow_id,activation,node,path,interval_ms,due) VALUES(?,?,?,?,?,?)')
            .run(
              row.id,
              active.id,
              node.id,
              String(node.config[node.type === 'mesh.disk@1' ? 'mount' : 'path']),
              Number(node.config['intervalMs']),
              this.now()
            );
        }
      return this.saved(this.scoped(data));
    });
  }
  private handleEvent(
    row: Stored,
    activation: string,
    event: FlowEvent,
    origin: 'input' | 'host' | 'daemon'
  ): FlowReceipt {
    const active = activeOf(row);
    if (!active || active.id !== activation) throw Error('Flow activation changed');
    this.verifyActivation(row.id, activation);
    validateFlowEvent(event);
    const source = active.definition.nodes.find((n) => n.id === event.source);
    if (
      !source ||
      (origin === 'host') !== (source.type === 'host.disk@1' || source.type === 'mesh.disk@1') ||
      (origin === 'input' &&
        ['host.disk.sample', 'mesh.disk.sample', 'stack.started', 'stack.stopped'].includes(event.type))
    )
      throw Error('This source only accepts observations from its registered provider');
    const stored = this.db.prepare('SELECT * FROM flow_events WHERE flow_id=? AND activation=? AND event_id=?');
    const previous = stored.get(row.id, activation, event.id) as EventRow | undefined;
    const payload = canonical(event);
    if (previous) {
      if (previous.event !== payload) throw Error('This event ID already belongs to different input');
      return this.receipt(row.id, previous);
    }
    const result = this.compiled.get(row.id)!.evaluate(event, JSON.parse(row.state) as FlowState);
    const state = JSON.stringify(result.state);
    this.db
      .prepare(
        'INSERT INTO flow_events(flow_id,activation,event_id,revision,event,at,visited,traversed,state,sample_only) VALUES(?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        row.id,
        activation,
        event.id,
        active.revision,
        payload,
        this.now(),
        JSON.stringify(result.visited),
        JSON.stringify(result.traversed),
        state,
        origin === 'host' && !result.effects.length && state === row.state ? 1 : 0
      );
    this.db.prepare('UPDATE flow_definitions SET state=? WHERE id=?').run(state, row.id);
    for (const effect of result.effects) {
      const id = randomUUID(); // Persisted before dispatch. Every retry passes this same ID to the owning service.
      const title = String(effect.config['title'] ?? effect.config['task'] ?? effect.config['pipelineId']);
      this.db
        .prepare(
          'INSERT INTO flow_deliveries(id,flow_id,activation,event_id,node,kind,title,effect,status) VALUES(?,?,?,?,?,?,?,?,?)'
        )
        .run(
          id,
          row.id,
          activation,
          event.id,
          effect.nodeId,
          effect.kind,
          title,
          JSON.stringify(effect),
          effect.kind === 'notification' ? 'delivered' : 'pending'
        );
    }
    if (origin === 'host')
      this.db
        .prepare(
          'DELETE FROM flow_events WHERE rowid IN (SELECT rowid FROM flow_events WHERE flow_id=? AND sample_only=1 ORDER BY rowid DESC LIMIT -1 OFFSET 128)'
        )
        .run(row.id);
    return this.receipt(row.id, stored.get(row.id, activation, event.id) as EventRow);
  }
  submit(ref: FlowRef, activation: string, event: FlowEvent): FlowReceipt {
    return this.commit(() => this.handleEvent(this.scoped(ref), activation, event, 'input'));
  }
  due(): DiskSource[] {
    return this.db
      .prepare('SELECT * FROM flow_sources WHERE due<=? ORDER BY due,flow_id,node LIMIT 64')
      .all(this.now()) as DiskSource[];
  }
  settleSample(source: DiskSource, observation: { freeBytes: number; totalBytes: number } | Error) {
    return this.commit(() => {
      const advanced = this.db
        .prepare('UPDATE flow_sources SET due=?,error=? WHERE flow_id=? AND activation=? AND node=? AND due=?')
        .run(
          this.now() + source.interval_ms,
          observation instanceof Error ? observation.message : null,
          source.flow_id,
          source.activation,
          source.node,
          source.due
        );
      if (advanced.changes && !(observation instanceof Error))
        return this.handleEvent(
          this.byId(source.flow_id)!,
          source.activation,
          {
            id: 'sample:' + source.node + ':' + source.due,
            source: source.node,
            type: Object.hasOwn(observation, 'nodeId') ? 'mesh.disk.sample' : 'host.disk.sample',
            data: observation,
          },
          'host'
        );
      return undefined;
    });
  }
  stackSources(type: string, project: string, stack: string) {
    const rows = this.db.prepare('SELECT * FROM flow_definitions WHERE active IS NOT NULL').all() as Stored[];
    return rows.flatMap((row) => {
      const active = activeOf(row)!;
      const binding = JSON.parse(row.binding!) as FlowBinding;
      if (
        row.project &&
        !(row.project === project && (!row.stack || row.stack === stack)) &&
        !(binding.target?.project === project && binding.target.stack === stack)
      )
        return [];
      return active.definition.nodes
        .filter((n) => n.type === 'input.event@1' && n.config['eventType'] === type)
        .map((n) => ({ id: row.id, activation: active.id, source: n.id }));
    });
  }
  recordStackEvent(
    target: { id: string; activation: string; source: string },
    type: string,
    data: FlowData,
    eventId: string
  ) {
    this.commit(() =>
      this.handleEvent(
        this.byId(target.id)!,
        target.activation,
        { id: eventId + ':' + target.source, source: target.source, type, data },
        'daemon'
      )
    );
  }
  private receipt(flow: string, row: EventRow): FlowReceipt {
    const parts = this.db
      .prepare(
        'SELECT id,kind,node,title,status,result,error FROM flow_deliveries WHERE flow_id=? AND activation=? AND event_id=? ORDER BY rowid'
      )
      .all(flow, row.activation, row.event_id) as DeliverySummary[];
    return {
      event: JSON.parse(row.event),
      activation: row.activation,
      revision: row.revision,
      at: row.at,
      visited: JSON.parse(row.visited),
      traversed: JSON.parse(row.traversed),
      state: JSON.parse(row.state),
      deliveries: parts.map(publicDelivery),
    };
  }
  history(ref: FlowRef, limit = 50): FlowReceipt[] {
    this.scoped(ref);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw Error('Select between 1 and 200 flow receipts');
    return (
      this.db
        .prepare('SELECT * FROM flow_events WHERE flow_id=? ORDER BY rowid DESC LIMIT ?')
        .all(ref.id, limit) as EventRow[]
    ).map((row) => this.receipt(ref.id, row));
  }
  notifications(workspace: FlowWorkspace, after?: number, limit = 32): FlowNotificationPage {
    checkFlowWorkspace(workspace);
    if (
      (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw Error('Invalid notification cursor or page size');
    const scope = [workspace.project ?? '', workspace.stack ?? null, workspace.stack ?? null];
    const source = ' FROM flow_deliveries d JOIN flow_definitions f ON f.id=d.flow_id';
    const matches = " WHERE d.kind='notification' AND f.project=? AND (? IS NULL OR f.stack=?)";
    if (after === undefined) {
      const row = this.db.prepare('SELECT max(d.sequence) AS last' + source + matches).get(...scope) as {
        last: number | null;
      };
      return { cursor: row.last ?? 0, items: [] };
    }
    const items = this.db
      .prepare(
        'SELECT d.sequence,d.id,d.flow_id AS flowId,d.title,e.at' +
          source +
          ' JOIN flow_events e ON e.flow_id=d.flow_id AND e.activation=d.activation AND e.event_id=d.event_id' +
          matches +
          ' AND d.sequence>? ORDER BY d.sequence LIMIT ?'
      )
      .all(...scope, after, limit) as FlowNotificationPage['items'];
    return { cursor: items.at(-1)?.sequence ?? after, items };
  }
  pending() {
    return this.db
      .prepare("SELECT id FROM flow_deliveries WHERE status IN ('pending','dispatching') ORDER BY rowid LIMIT 32")
      .all() as {
      id: string;
    }[];
  }
  nextDue(): number | null {
    if (this.db.prepare("SELECT 1 FROM flow_deliveries WHERE status IN ('pending','dispatching') LIMIT 1").get())
      return this.now();
    return (this.db.prepare('SELECT min(due) AS due FROM flow_sources').get() as { due: number | null }).due;
  }
  delivery(id: string) {
    const row = this.db.prepare('SELECT * FROM flow_deliveries WHERE id=?').get(id) as OutboxRow | undefined;
    if (!row) throw Error('Flow delivery not found');
    const flow = this.byId(row.flow_id)!;
    return {
      row,
      public: publicDelivery(row),
      active: activeOf(flow),
      workspace: workspaceOf(flow),
      session: row.retry_session ?? flow.session,
      effect: JSON.parse(row.effect) as FlowEffect,
    };
  }
  markDispatch(row: Pick<OutboxRow, 'id' | 'activation' | 'attempt'>, session: string | null) {
    const claim = () => {
      const updated = this.db
        .prepare(
          `UPDATE flow_deliveries SET status='dispatching'
        WHERE id=? AND activation=? AND attempt=? AND status IN ('pending','dispatching')
        AND EXISTS (SELECT 1 FROM flow_definitions f WHERE f.id=flow_deliveries.flow_id
          AND json_extract(f.active,'$.id')=? AND COALESCE(flow_deliveries.retry_session,f.session) IS ?)`
        )
        .run(row.id, row.activation, row.attempt, row.activation, session);
      if (!updated.changes) throw Error('The flow activation changed before dispatch');
    };
    // A local receiver can journal this mark in the same transaction that admits its command.
    if (this.db.inTransaction) claim();
    else this.commit(claim);
  }
  finish(row: Pick<OutboxRow, 'id' | 'attempt'>, result: string | null, error: string | null, unconfirmed = false) {
    this.commit(() => {
      if (error === null) {
        // A receiver's exact receipt can arrive after pause, replacement or uncertain transport.
        this.db
          .prepare(
            "UPDATE flow_deliveries SET status='delivered',retry_session=NULL,result=?,error=NULL WHERE id=? AND status IN ('pending','dispatching','unconfirmed','needs-review')"
          )
          .run(result, row.id);
      } else {
        this.db
          .prepare(
            `UPDATE flow_deliveries SET
          retry_session=NULL,result=CASE WHEN status='dispatching' OR ? THEN id ELSE NULL END,
          status=CASE WHEN status='dispatching' OR ? THEN 'unconfirmed' ELSE 'needs-review' END, error=?
          WHERE id=? AND attempt=? AND status IN ('pending','dispatching')`
          )
          .run(Number(unconfirmed), Number(unconfirmed), error, row.id, row.attempt);
      }
    });
  }
  retry(ref: FlowRef, activation: string, id: string, authority: FlowAuthority) {
    return this.commit(() => {
      const flow = this.scoped(ref),
        active = activeOf(flow),
        delivery = this.delivery(id);
      if (
        !active ||
        active.id !== activation ||
        active.actor !== authority.actor ||
        delivery.row.flow_id !== ref.id ||
        delivery.row.activation !== activation
      )
        throw Error('Review the delivery in its original account and active workspace');
      if (delivery.public.status === 'needs-review') {
        if (!authority.session) throw Error('Sign in to authorize this delivery');
        this.db
          .prepare(
            "UPDATE flow_deliveries SET status='pending',retry_session=?,attempt=attempt+1,error=NULL WHERE id=?"
          )
          .run(authority.session, id);
      }
      return this.delivery(id).public;
    });
  }
}
