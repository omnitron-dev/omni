import { randomUUID } from 'node:crypto';
import { STUDIO_PROVIDER_LIMIT } from '../shared/dto/studio-policy.js';
import { StudioTeamLedger, publicDecision, publicTurn, turnColumns } from './team-ledger.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type {
  StudioProvider,
  StudioReview,
  StudioSend,
  StudioThread,
  StudioTurn,
  StudioResult,
  StudioStatus,
  StudioThreadCursor,
} from '../shared/dto/studio.js';

export interface StudioScope {
  account: string;
  project: string;
  directory: string;
}
export interface StudioLink extends StudioScope {
  id: string;
  provider: StudioProvider;
  expires: number;
  catalog: string;
}
export interface StudioJob {
  memberId: string;
  shared: number;
  id: string;
  threadId: string;
  prompt: string;
  session: string | null;
  conversation: string | null;
  stack: string | null;
  assignment: string;
}

const scopeValues = (s: StudioScope) => [s.account, s.project, s.directory];
const threadColumns = 'id, title, provider, updatedAt, assignment, stack';
const lease = 45_000;
const threadPageSize = 40;
const turnPageSize = 8;
const pendingPerConnector = 16;

/** Local private state. SQLite serializes each admission, including across a backend handoff. */
export class StudioLedger {
  readonly teams: StudioTeamLedger;
  constructor(
    private readonly db: ReturnType<DaemonStateStore['initSync']>,
    private readonly clock = Date.now
  ) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_connections (
        id TEXT PRIMARY KEY, account TEXT NOT NULL, project TEXT NOT NULL, directory TEXT NOT NULL,
        provider TEXT NOT NULL, expires INTEGER NOT NULL, catalog TEXT NOT NULL,
        UNIQUE(account, project, directory, provider)
      );
      CREATE TABLE IF NOT EXISTS studio_threads (
        id TEXT PRIMARY KEY, account TEXT NOT NULL, project TEXT NOT NULL, directory TEXT NOT NULL,
        provider TEXT NOT NULL, title TEXT NOT NULL, updatedAt INTEGER NOT NULL, conversation TEXT,
        assignment TEXT NOT NULL, stack TEXT
      );
      CREATE INDEX IF NOT EXISTS studio_list ON studio_threads(account,project,directory,updatedAt DESC,id DESC);
      CREATE INDEX IF NOT EXISTS studio_stack_list ON studio_threads(account,project,directory,stack,updatedAt DESC,id DESC);
      CREATE TABLE IF NOT EXISTS studio_turns (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, threadId TEXT NOT NULL REFERENCES studio_threads(id),
        connection TEXT NOT NULL, session TEXT, prompt TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL, failure TEXT, createdAt INTEGER NOT NULL, usage TEXT, review TEXT, parent TEXT
      );
      CREATE INDEX IF NOT EXISTS studio_history ON studio_turns(threadId, seq);
      CREATE INDEX IF NOT EXISTS studio_dispatch ON studio_turns(connection, status, seq);
      CREATE TABLE IF NOT EXISTS studio_withdrawn (
        account TEXT NOT NULL, project TEXT NOT NULL, directory TEXT NOT NULL, threadId TEXT NOT NULL,
        turnId TEXT NOT NULL, PRIMARY KEY (account,project,directory,threadId,turnId)
      ) WITHOUT ROWID;
    `);
    this.teams = new StudioTeamLedger(db, clock);
  }

  private reap() {
    const expired = this.db.prepare('SELECT id FROM studio_connections WHERE expires <= ?').all(this.clock()) as {
      id: string;
    }[];
    for (const row of expired) this.disconnect(row.id);
  }

  connect(scope: StudioScope, provider: StudioProvider, catalog: string, capacity = 1) {
    return this.db
      .transaction(() => {
        this.reap();
        if (this.linkFor(scope, provider))
          throw Error('This adapter is already connected for the selected account and project');
        const { count } = this.db
          .prepare('SELECT count(*) AS count FROM studio_connections WHERE account=? AND project=? AND directory=?')
          .get(...scopeValues(scope)) as { count: number };
        if (count >= STUDIO_PROVIDER_LIMIT)
          throw Error(`A Studio workspace supports up to ${STUDIO_PROVIDER_LIMIT} connected providers`);
        const id = randomUUID();
        this.db
          .prepare(
            'INSERT INTO studio_connections (id, account, project, directory, provider, expires, catalog, capacity) VALUES (?,?,?,?,?,?,?,?)'
          )
          .run(id, ...scopeValues(scope), provider, this.clock() + lease, catalog, capacity);
        return id;
      })
      .immediate();
  }

  disconnect(id: string) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE studio_turns SET status = CASE status WHEN 'queued' THEN 'cancelled' ELSE 'interrupted' END, failure='disconnected', session=NULL WHERE connection=? AND status IN ('queued','running')"
        )
        .run(id);
      this.db.prepare('DELETE FROM studio_connections WHERE id=?').run(id);
    })();
  }

  connection(id: string): StudioLink {
    const row = this.db
      .prepare('UPDATE studio_connections SET expires=? WHERE id=? AND expires>? RETURNING *')
      .get(this.clock() + lease, id, this.clock()) as StudioLink | undefined;
    if (!row) throw Error('Adapter connection expired. Connect again from the project directory.');
    return row;
  }

  linkFor(scope: StudioScope, provider: StudioProvider) {
    return this.db
      .prepare(
        'SELECT * FROM studio_connections WHERE account=? AND project=? AND directory=? AND provider=? AND expires>?'
      )
      .get(...scopeValues(scope), provider, this.clock()) as StudioLink | undefined;
  }

  workspace(scope: StudioScope, stack?: string, before?: StudioThreadCursor) {
    this.reap();
    const links = this.db
      .prepare(
        'SELECT provider, catalog FROM studio_connections WHERE account=? AND project=? AND directory=? ORDER BY provider'
      )
      .all(...scopeValues(scope)) as Pick<StudioLink, 'provider' | 'catalog'>[];
    const rows = this.db
      .prepare(
        'SELECT ' +
          threadColumns +
          ' FROM studio_threads WHERE account=? AND project=? AND directory=?' +
          (stack ? ' AND stack=?' : '') +
          (before ? ' AND (updatedAt,id)<(?,?)' : '') +
          ' ORDER BY updatedAt DESC, id DESC LIMIT ?'
      )
      .all(
        ...scopeValues(scope),
        ...(stack ? [stack] : []),
        ...(before ? [before.updatedAt, before.id] : []),
        threadPageSize + 1
      ) as StoredThread[];
    const threads = rows.slice(0, threadPageSize).map(threadView);
    const last = threads.at(-1);
    return {
      links,
      threads,
      older: last && rows.length > threadPageSize ? { updatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  private owned(scope: StudioScope, threadId: string) {
    return this.db
      .prepare(
        'SELECT ' + threadColumns + ' FROM studio_threads WHERE id=? AND account=? AND project=? AND directory=?'
      )
      .get(threadId, ...scopeValues(scope)) as StoredThread | undefined;
  }

  thread(scope: StudioScope, id: string, before?: string, includeTasks = true) {
    this.reap();
    const thread = this.owned(scope, id);
    if (!thread) throw Error('Conversation unavailable in this workspace');
    const boundary = before
      ? (this.db.prepare('SELECT seq FROM studio_turns WHERE threadId=? AND id=?').get(id, before) as
          { seq: number } | undefined)
      : undefined;
    if (before && !boundary) throw Error('Turn cursor unavailable in this conversation');
    const rows = this.db
      .prepare(
        'SELECT ' +
          turnColumns +
          ' FROM studio_turns WHERE threadId=?' +
          (boundary ? ' AND seq<?' : '') +
          ' ORDER BY seq DESC LIMIT ?'
      )
      .all(id, ...(boundary ? [boundary.seq] : []), turnPageSize + 1) as (Omit<StudioTurn, 'usage' | 'review'> & {
      usage: string | null;
      review: string | null;
    })[];
    const turns = rows.slice(0, turnPageSize).reverse();
    return {
      thread: threadView(thread),
      beforeTurn: rows.length > turnPageSize ? turns[0]!.id : null,
      turns: turns.map(publicTurn),
      team: this.teams.snapshot(id, includeTasks),
    };
  }

  send(
    scope: StudioScope,
    data: StudioSend & { requestKey: string },
    session: string | null,
    assignment: () => string
  ) {
    return this.db
      .transaction(() => {
        this.reap();
        if (
          this.db
            .prepare(
              'SELECT 1 FROM studio_withdrawn WHERE account=? AND project=? AND directory=? AND threadId=? AND turnId=?'
            )
            .get(...scopeValues(scope), data.threadId, data.turnId)
        )
          throw Error('This request was withdrawn');
        const existing = this.owned(scope, data.threadId);
        if (existing && this.teams.room(scope, data.threadId).policy)
          throw Error('Address a member of the team when sending a message');
        const previous = this.db
          .prepare('SELECT threadId, prompt, parent FROM studio_turns WHERE id=?')
          .get(data.turnId) as { threadId: string; prompt: string; parent: string | null } | undefined;
        if (previous) {
          if (
            !existing ||
            previous.threadId !== data.threadId ||
            previous.prompt !== data.prompt ||
            previous.parent !== data.after ||
            existing.provider !== data.provider ||
            existing.stack !== (data.stack ?? null) ||
            JSON.parse(existing.assignment).requestKey !== data.requestKey
          )
            throw Error('Turn identity already used for a different request');
          return;
        }
        const link = this.linkFor(scope, data.provider);
        if (!link) throw Error('Connect this adapter before sending a message');
        const pending = this.db
          .prepare("SELECT count(*) AS total FROM studio_turns WHERE connection=? AND status IN ('queued','running')")
          .get(link.id) as { total: number };
        if (pending.total >= pendingPerConnector)
          throw Error('The connector queue is full. Wait for an outstanding turn to finish.');
        if (existing) {
          if (
            existing.provider !== data.provider ||
            existing.stack !== (data.stack ?? null) ||
            JSON.parse(existing.assignment).requestKey !== data.requestKey
          )
            throw Error('Assignment changed. Start a new conversation.');
          const last = this.db
            .prepare('SELECT id,status FROM studio_turns WHERE threadId=? ORDER BY seq DESC LIMIT 1')
            .get(data.threadId) as { id: string; status: string };
          if (last.id !== data.after) throw Error('Conversation changed. Read the latest turn before sending.');
          if (last.status === 'running' || last.status === 'queued') throw Error('A turn is already in progress');
          if (last.status !== 'completed')
            throw Error(
              'The previous turn did not finish. Start a new conversation to keep provider history unambiguous.'
            );
        } else {
          if (data.after !== null) throw Error('Conversation unavailable in this workspace');
          this.db
            .prepare(
              'INSERT INTO studio_threads (id,account,project,directory,provider,title,updatedAt,assignment,stack) VALUES (?,?,?,?,?,?,?,?,?)'
            )
            .run(
              data.threadId,
              ...scopeValues(scope),
              data.provider,
              data.prompt.trim().split(/\s+/).join(' ').slice(0, 72),
              this.clock(),
              assignment(),
              data.stack ?? null
            );
        }
        this.db
          .prepare(
            "INSERT INTO studio_turns (id,threadId,connection,session,prompt,status,createdAt,parent) VALUES (?,?,?,?,?,'queued',?,?)"
          )
          .run(data.turnId, data.threadId, link.id, session, data.prompt, this.clock(), data.after);
        this.db.prepare('UPDATE studio_threads SET updatedAt=? WHERE id=?').run(this.clock(), data.threadId);
      })
      .immediate();
  }

  cancel(scope: StudioScope, threadId: string, turnId: string) {
    return this.db
      .transaction(() => {
        const turn =
          this.owned(scope, threadId) &&
          (this.db.prepare('SELECT status FROM studio_turns WHERE threadId=? AND id=?').get(threadId, turnId) as
            { status: StudioStatus } | undefined);
        if (!turn) {
          // A late delivery must remain withdrawn even when cancel arrives before send.
          this.db
            .prepare('INSERT OR IGNORE INTO studio_withdrawn VALUES (?,?,?,?,?)')
            .run(...scopeValues(scope), threadId, turnId);
          return { status: 'withdrawn' as const };
        }
        this.teams.cancelBranch(threadId, turnId);
        return { status: turn.status === 'queued' || turn.status === 'running' ? ('cancelled' as const) : turn.status };
      })
      .immediate();
  }

  review(
    scope: StudioScope,
    threadId: string,
    turnId: string,
    previous: number | null,
    outcome: StudioReview['outcome'],
    note: string
  ) {
    if (!this.owned(scope, threadId)) throw Error('Conversation unavailable in this workspace');
    const at = Math.max(this.clock(), (previous ?? 0) + 1);
    const updated = this.db
      .prepare(
        "UPDATE studio_turns SET review=? WHERE id=? AND threadId=? AND status='completed' AND json_extract(review,'$.at') IS ?"
      )
      .run(JSON.stringify({ at, outcome, note }), turnId, threadId, previous);
    if (!updated.changes) throw Error('Read the completed turn and its current review first');
  }

  pending(id: string) {
    this.teams.collect(id);
    return this.db
      .prepare(
        `
      SELECT t.id,t.threadId,t.session,t.prompt,t.shared,m.id AS memberId,m.conversation,h.stack,m.assignment
      FROM studio_turns t JOIN studio_threads h ON h.id=t.threadId
      JOIN studio_team_members m ON m.threadId=t.threadId AND m.id=COALESCE(t.memberId,t.threadId) AND m.active=1
      JOIN studio_connections c ON c.id=t.connection
      WHERE c.id=? AND t.status='queued' AND
        (SELECT count(*) FROM studio_turns a WHERE a.connection=c.id AND a.status='running')<c.capacity
        AND NOT EXISTS(SELECT 1 FROM studio_turns a WHERE a.threadId=t.threadId
          AND COALESCE(a.memberId,a.threadId)=m.id AND (a.status='running' OR (a.status='queued' AND a.seq<t.seq)))
      ORDER BY t.seq LIMIT 1
    `
      )
      .get(id) as StudioJob | undefined;
  }

  claim(link: string, turnId: string): boolean {
    // Recheck capacity after async session, registration and model verification.
    return (
      this.db
        .prepare(
          `UPDATE studio_turns AS t SET status='running'
      WHERE t.id=? AND t.connection=? AND t.status='queued' AND EXISTS
      (SELECT 1 FROM studio_connections c WHERE c.id=t.connection AND c.expires>? AND
        (SELECT count(*) FROM studio_turns a WHERE a.connection=c.id AND a.status='running')<c.capacity)
      AND NOT EXISTS (SELECT 1 FROM studio_turns a WHERE a.threadId=t.threadId AND
        COALESCE(a.memberId,a.threadId)=COALESCE(t.memberId,t.threadId) AND (a.status='running' OR (a.status='queued' AND a.seq<t.seq)))`
        )
        .run(turnId, link, this.clock()).changes === 1
    );
  }

  active(link: string, turnId: string) {
    return this.db
      .prepare("SELECT session FROM studio_turns WHERE id=? AND connection=? AND status='running'")
      .get(turnId, link) as { session: string | null } | undefined;
  }

  preview(link: string, id: string, answer: string) {
    this.db
      .prepare("UPDATE studio_turns SET answer=? WHERE id=? AND connection=? AND status='running' AND answer<>?")
      .run(answer, id, link, answer);
  }

  refuse(link: string, id: string, reason: 'authorization' | 'model-changed' | 'scope-unavailable' = 'authorization') {
    this.db
      .prepare(
        "UPDATE studio_turns SET status='failed',failure=?,session=NULL WHERE id=? AND connection=? AND status IN ('queued','running')"
      )
      .run(reason, id, link);
  }

  finish(link: string, id: string, result: StudioResult) {
    return this.db
      .transaction(() => {
        const applied = this.db
          .prepare(
            "UPDATE studio_turns SET status=?,answer=COALESCE(?,answer),failure=?,usage=?,session=NULL WHERE id=? AND connection=? AND status='running' RETURNING threadId, COALESCE(memberId,threadId) AS memberId"
          )
          .get(
            result.status,
            result.status === 'completed' ? result.answer : null,
            result.status === 'failed' ? result.failure : null,
            result.status === 'completed' && result.usage ? JSON.stringify(result.usage) : null,
            id,
            link
          ) as { threadId: string; memberId: string } | undefined;
        if (applied && result.status === 'completed' && applied.threadId !== applied.memberId) {
          this.db
            .prepare('UPDATE studio_peers SET conversation=? WHERE threadId=? AND id=?')
            .run(result.conversation, applied.threadId, applied.memberId);
          this.db.prepare('UPDATE studio_threads SET updatedAt=? WHERE id=?').run(this.clock(), applied.threadId);
        } else if (applied && result.status === 'completed')
          this.db
            .prepare('UPDATE studio_threads SET conversation=?,updatedAt=? WHERE id=?')
            .run(result.conversation, this.clock(), applied.threadId);
        return Boolean(applied);
      })
      .immediate();
  }
}

interface StoredThread extends Omit<StudioThread, 'assignment'> {
  assignment: string;
}
function threadView(row: StoredThread): StudioThread {
  return { ...row, leadMemberId: row.id, assignment: publicDecision(row.assignment) };
}
