import { randomUUID } from 'node:crypto';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type {
  StudioProvider,
  StudioReview,
  StudioSend,
  StudioThread,
  StudioTurn,
  StudioResult,
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

/** Local private state. SQLite serializes each admission, including across a backend handoff. */
export class StudioLedger {
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
      CREATE INDEX IF NOT EXISTS studio_workspace ON studio_threads(account,project,directory,updatedAt DESC);
      CREATE TABLE IF NOT EXISTS studio_turns (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, threadId TEXT NOT NULL REFERENCES studio_threads(id),
        connection TEXT NOT NULL, session TEXT, prompt TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL, failure TEXT, createdAt INTEGER NOT NULL, usage TEXT, review TEXT, parent TEXT
      );
      CREATE INDEX IF NOT EXISTS studio_history ON studio_turns(threadId, seq);
      CREATE INDEX IF NOT EXISTS studio_dispatch ON studio_turns(connection, status, seq);
      CREATE UNIQUE INDEX IF NOT EXISTS studio_active_turn ON studio_turns(threadId) WHERE status IN ('queued','running');
      CREATE UNIQUE INDEX IF NOT EXISTS studio_active_connector ON studio_turns(connection) WHERE status = 'running';
    `);
  }

  private reap() {
    const expired = this.db.prepare('SELECT id FROM studio_connections WHERE expires <= ?').all(this.clock()) as {
      id: string;
    }[];
    for (const row of expired) this.disconnect(row.id);
  }

  connect(scope: StudioScope, provider: StudioProvider, catalog: string) {
    return this.db
      .transaction(() => {
        this.reap();
        if (this.linkFor(scope, provider))
          throw Error('This adapter is already connected for the selected account and project');
        const id = randomUUID();
        this.db
          .prepare(
            'INSERT INTO studio_connections (id, account, project, directory, provider, expires, catalog) VALUES (?,?,?,?,?,?,?)'
          )
          .run(id, ...scopeValues(scope), provider, this.clock() + lease, catalog);
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

  workspace(scope: StudioScope) {
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
          ' FROM studio_threads WHERE account=? AND project=? AND directory=? ORDER BY updatedAt DESC, rowid DESC'
      )
      .all(...scopeValues(scope)) as StoredThread[];
    return { links, threads: rows.map(threadView) };
  }

  private owned(scope: StudioScope, threadId: string) {
    return this.db
      .prepare(
        'SELECT ' + threadColumns + ' FROM studio_threads WHERE id=? AND account=? AND project=? AND directory=?'
      )
      .get(threadId, ...scopeValues(scope)) as StoredThread | undefined;
  }

  thread(scope: StudioScope, id: string) {
    this.reap();
    const thread = this.owned(scope, id);
    if (!thread) throw Error('Conversation unavailable in this workspace');
    const turns = this.db
      .prepare(
        'SELECT id, prompt, answer, status, failure, createdAt, usage, review FROM studio_turns WHERE threadId=? ORDER BY seq'
      )
      .all(id) as (Omit<StudioTurn, 'usage' | 'review'> & { usage: string | null; review: string | null })[];
    return {
      thread: threadView(thread),
      turns: turns.map((row) => ({
        ...row,
        usage: row.usage ? JSON.parse(row.usage) : null,
        review: row.review ? (JSON.parse(row.review) as StudioReview) : null,
      })),
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
        const existing = this.owned(scope, data.threadId);
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
    if (!this.owned(scope, threadId)) throw Error('Conversation unavailable in this workspace');
    this.db
      .prepare(
        "UPDATE studio_turns SET status='cancelled',session=NULL WHERE threadId=? AND id=? AND status IN ('queued','running')"
      )
      .run(threadId, turnId);
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
    return this.db
      .prepare(
        `SELECT t.id,t.threadId,t.session,t.prompt,h.conversation,h.stack,h.assignment FROM studio_turns t
      JOIN studio_threads h ON h.id=t.threadId WHERE t.connection=? AND t.status='queued'
      AND NOT EXISTS (SELECT 1 FROM studio_turns a WHERE a.connection=t.connection AND a.status='running')
      ORDER BY t.seq LIMIT 1`
      )
      .get(id) as StudioJob | undefined;
  }

  claim(link: string, turnId: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE studio_turns SET status='running' WHERE id=? AND connection=? AND status='queued' AND EXISTS (SELECT 1 FROM studio_connections WHERE id=? AND expires>?)"
        )
        .run(turnId, link, link, this.clock()).changes === 1
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
            "UPDATE studio_turns SET status=?,answer=COALESCE(?,answer),failure=?,usage=?,session=NULL WHERE id=? AND connection=? AND status='running' RETURNING threadId"
          )
          .get(
            result.status,
            result.status === 'completed' ? result.answer : null,
            result.status === 'failed' ? result.failure : null,
            result.status === 'completed' && result.usage ? JSON.stringify(result.usage) : null,
            id,
            link
          ) as { threadId: string } | undefined;
        if (applied && result.status === 'completed')
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
  const { preferences, selection } = JSON.parse(row.assignment);
  return { ...row, assignment: { preferences, selection } };
}
