import type { StudioUsageReport } from '../shared/dto/studio-policy.js';
import { randomUUID } from 'node:crypto';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { FlowDefinition } from '../shared/dto/flows.js';
import type {
  StudioDecision,
  StudioFlowProposal,
  StudioMember,
  StudioNote,
  StudioNoteInput,
  StudioPost,
  StudioProvider,
  StudioReview,
  StudioTeam,
  StudioTeamPolicy,
  StudioTurn,
} from '../shared/dto/studio.js';
import type { StudioScope } from './ledger.js';

type Database = ReturnType<DaemonStateStore['initSync']>;
interface MemberRow {
  id: string;
  name: string;
  provider: StudioProvider;
  assignment: string;
  lead: number;
  active: number;
}
interface Room {
  id: string;
  title: string;
  leadName: string;
  provider: StudioProvider;
  stack: string | null;
  policy: string | null;
  assignment: string;
}
export interface StudioPrincipalTurn {
  id: string;
  threadId: string;
  memberId: string;
  rootId: string;
  session: string | null;
}
type StoredTurn = Omit<StudioTurn, 'usage' | 'review'> & { usage: string | null; review: string | null };
export const turnColumns =
  'id,COALESCE(memberId,threadId) AS memberId,authorId,originId,kind,prompt,answer,status,failure,createdAt,usage,review';
export function publicTurn(row: StoredTurn): StudioTurn {
  return {
    ...row,
    usage: row.usage ? (JSON.parse(row.usage) as StudioUsageReport) : null,
    review: row.review ? (JSON.parse(row.review) as StudioReview) : null,
  };
}
export function publicDecision(value: string): StudioDecision {
  const { preferences, selection } = JSON.parse(value);
  return { preferences, selection };
}
function member(row: MemberRow): StudioMember {
  return { ...row, lead: !!row.lead, active: !!row.active, assignment: publicDecision(row.assignment) };
}
function addColumns(db: Database, table: string, columns: Record<string, string>) {
  const current = new Set((db.pragma('table_info(' + table + ')') as { name: string }[]).map((x) => x.name));
  for (const [name, definition] of Object.entries(columns)) {
    if (!current.has(name)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + definition);
  }
}

/** Each room owns its lead and each peer owns its provider conversation. No credential or private provider transcript is shared. */
export class StudioTeamLedger {
  constructor(
    private readonly db: Database,
    private readonly clock: () => number
  ) {
    db.transaction(() => {
      addColumns(db, 'studio_threads', { leadName: "TEXT NOT NULL DEFAULT 'Lead'", policy: 'TEXT' });
      addColumns(db, 'studio_connections', { capacity: 'INTEGER NOT NULL DEFAULT 1' });
      addColumns(db, 'studio_turns', {
        memberId: 'TEXT',
        authorId: 'TEXT',
        kind: "TEXT NOT NULL DEFAULT 'message'",
        originId: 'TEXT',
        rootId: 'TEXT',
        shared: 'INTEGER NOT NULL DEFAULT 0',
      });
      db.exec(`
        DROP INDEX IF EXISTS studio_active_turn;
        DROP INDEX IF EXISTS studio_active_connector;
        CREATE UNIQUE INDEX IF NOT EXISTS studio_running_member ON studio_turns(threadId,COALESCE(memberId,threadId)) WHERE status='running';
        CREATE INDEX IF NOT EXISTS studio_round ON studio_turns(rootId,kind);
        CREATE INDEX IF NOT EXISTS studio_children ON studio_turns(originId,kind,status);
        CREATE INDEX IF NOT EXISTS studio_shared_history ON studio_turns(threadId, seq) WHERE shared=1;
        CREATE INDEX IF NOT EXISTS studio_task_history ON studio_turns(threadId, seq) WHERE kind='task';
        CREATE INDEX IF NOT EXISTS studio_outstanding ON studio_turns(threadId) WHERE status IN ('queued','running');
        CREATE TABLE IF NOT EXISTS studio_peers (
          threadId TEXT NOT NULL REFERENCES studio_threads(id), id TEXT NOT NULL, name TEXT NOT NULL, provider TEXT NOT NULL,
          assignment TEXT NOT NULL, conversation TEXT, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(threadId,id)
        );
        CREATE VIEW IF NOT EXISTS studio_team_members AS
          SELECT id AS threadId,id,leadName AS name,provider,assignment,conversation,1 AS active,1 AS lead FROM studio_threads
          UNION ALL SELECT threadId,id,name,provider,assignment,conversation,active,0 FROM studio_peers;
        CREATE TABLE IF NOT EXISTS studio_notes (
          threadId TEXT NOT NULL REFERENCES studio_threads(id),key TEXT NOT NULL,text TEXT NOT NULL,revision INTEGER NOT NULL,authorId TEXT,updatedAt INTEGER NOT NULL,PRIMARY KEY(threadId,key)
        );
        CREATE TABLE IF NOT EXISTS studio_gathers (
          originId TEXT PRIMARY KEY REFERENCES studio_turns(id), rootId TEXT NOT NULL, threadId TEXT NOT NULL REFERENCES studio_threads(id),
          session TEXT
        );
        CREATE TABLE IF NOT EXISTS studio_flow_proposals (
          threadId TEXT NOT NULL REFERENCES studio_threads(id),id TEXT NOT NULL,name TEXT NOT NULL,authorId TEXT NOT NULL,createdAt INTEGER NOT NULL,
          definition TEXT NOT NULL,PRIMARY KEY(threadId,id)
        );
        CREATE TABLE IF NOT EXISTS studio_tool_receipts (
          originId TEXT NOT NULL REFERENCES studio_turns(id),id TEXT NOT NULL,request TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(originId,id)
        );
        CREATE TRIGGER IF NOT EXISTS studio_discard_uncertain_conversation
        AFTER UPDATE OF status ON studio_turns WHEN OLD.shared=1 AND OLD.status='running' AND NEW.status IN ('interrupted','cancelled','failed')
        BEGIN
          UPDATE studio_threads SET conversation=NULL WHERE id=NEW.threadId AND id=NEW.memberId;
          UPDATE studio_peers SET conversation=NULL WHERE threadId=NEW.threadId AND id=NEW.memberId;
        END;
      `);
    }).immediate();
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  room(scope: StudioScope, id: string) {
    const row = this.db
      .prepare(
        'SELECT id,title,leadName,provider,assignment,stack,policy FROM studio_threads WHERE id=? AND account=? AND project=? AND directory=?'
      )
      .get(id, scope.account, scope.project, scope.directory) as Room | undefined;
    if (!row) throw Error('Conversation unavailable in this workspace');
    return row;
  }
  private touch(id: string) {
    this.db.prepare('UPDATE studio_threads SET updatedAt=? WHERE id=?').run(this.clock(), id);
  }
  create(
    scope: StudioScope,
    id: string,
    title: string,
    name: string,
    provider: StudioProvider,
    stack: string | null,
    policy: StudioTeamPolicy,
    assignment: () => string
  ) {
    this.transaction(() => {
      const exists = this.db.prepare('SELECT 1 FROM studio_threads WHERE id=?').get(id);
      if (exists) {
        const room = this.room(scope, id);
        if (
          room.title !== title ||
          room.leadName !== name ||
          room.provider !== provider ||
          room.stack !== stack ||
          room.policy !== JSON.stringify(policy) ||
          JSON.stringify(publicDecision(room.assignment).preferences) !==
            JSON.stringify(publicDecision(assignment()).preferences)
        )
          throw Error('Room identity already used for a different team');
        return;
      }
      this.db
        .prepare(
          'INSERT INTO studio_threads (id,account,project,directory,provider,title,updatedAt,assignment,stack,leadName,policy) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
        )
        .run(
          id,
          scope.account,
          scope.project,
          scope.directory,
          provider,
          title,
          this.clock(),
          assignment(),
          stack,
          name,
          JSON.stringify(policy)
        );
    });
  }
  policy(id: string): StudioTeamPolicy {
    const row = this.db.prepare('SELECT policy FROM studio_threads WHERE id=?').get(id) as
      { policy: string | null } | undefined;
    if (!row?.policy) throw Error('Enable collaboration in this conversation first');
    return JSON.parse(row.policy);
  }
  configure(scope: StudioScope, id: string, policy: StudioTeamPolicy, previous: StudioTeamPolicy | null) {
    this.transaction(() => {
      const room = this.room(scope, id);
      const json = JSON.stringify(policy);
      if (room.policy === json) return;
      if (room.policy !== (previous && JSON.stringify(previous)))
        throw Error('Team policy changed. Read it before editing.');
      const active = this.members(id).filter((m) => m.active);
      if (active.length > policy.maxMembers || active.some((m) => !policy.providers.includes(m.provider)))
        throw Error('Policy must cover the active team');
      if (
        this.db.prepare("SELECT 1 FROM studio_turns WHERE threadId=? AND status IN ('queued','running')").get(id) ||
        this.db.prepare('SELECT 1 FROM studio_gathers WHERE threadId=?').get(id)
      )
        throw Error('Wait for outstanding team work before changing the policy');
      // Sharing starts a new provider context. The operator retains the individual transcript.
      this.db
        .prepare(
          'UPDATE studio_threads SET conversation=CASE WHEN policy IS NULL THEN NULL ELSE conversation END,policy=?,updatedAt=? WHERE id=?'
        )
        .run(json, this.clock(), id);
    });
  }
  members(id: string): StudioMember[] {
    return (
      this.db
        .prepare(
          'SELECT id,name,provider,assignment,lead,active FROM studio_team_members WHERE threadId=? ORDER BY lead DESC,name,id'
        )
        .all(id) as MemberRow[]
    ).map(member);
  }
  member(id: string, memberId: string) {
    const row = this.db
      .prepare(
        'SELECT id,name,provider,assignment,lead,active FROM studio_team_members WHERE threadId=? AND id=? AND active=1'
      )
      .get(id, memberId) as MemberRow | undefined;
    if (!row) throw Error('Member is unavailable in this team');
    return member(row);
  }
  invite(id: string, memberId: string, name: string, provider: StudioProvider, assignment: string) {
    return this.transaction(() => {
      const policy = this.policy(id);
      const people = this.members(id);
      const existing = people.find((p) => p.id === memberId);
      if (existing) {
        if (
          existing.lead ||
          !existing.active ||
          existing.name !== name ||
          existing.provider !== provider ||
          JSON.stringify(existing.assignment.preferences) !== JSON.stringify(publicDecision(assignment).preferences)
        )
          throw Error('Member identity already used');
        return { memberId };
      }
      if (!policy.providers.includes(provider)) throw Error('This provider is outside the approved team');
      if (people.filter((p) => p.active).length >= policy.maxMembers || people.length >= 96)
        throw Error('Team member limit reached');
      if (people.some((p) => p.active && p.name.toLowerCase() === name.toLowerCase()))
        throw Error('Choose a unique active member name');
      this.db
        .prepare('INSERT INTO studio_peers (threadId,id,name,provider,assignment) VALUES(?,?,?,?,?)')
        .run(id, memberId, name, provider, assignment);
      this.touch(id);
      return { memberId };
    });
  }
  retire(id: string, memberId: string) {
    this.transaction(() => {
      if (memberId === id) throw Error('The lead owns this team');
      const changes = this.db
        .prepare('UPDATE studio_peers SET active=0 WHERE threadId=? AND id=?')
        .run(id, memberId).changes;
      if (!changes) throw Error('Member is unavailable in this team');
      this.db
        .prepare(
          "UPDATE studio_turns SET status='cancelled',session=NULL WHERE threadId=? AND memberId=? AND status IN ('running','queued')"
        )
        .run(id, memberId);
      this.touch(id);
    });
  }
  private roomDetails(id: string) {
    return {
      members: this.members(id),
      notes: this.db
        .prepare('SELECT key,text,revision,authorId,updatedAt FROM studio_notes WHERE threadId=? ORDER BY key')
        .all(id) as StudioNote[],
      proposals: this.db
        .prepare(
          'SELECT id,name,authorId,createdAt FROM studio_flow_proposals WHERE threadId=? ORDER BY createdAt DESC,id DESC LIMIT 32'
        )
        .all(id) as StudioFlowProposal[],
    };
  }
  snapshot(id: string, includeTasks: boolean): StudioTeam {
    const row = this.db.prepare('SELECT policy FROM studio_threads WHERE id=?').get(id) as { policy: string | null };
    return {
      ...this.roomDetails(id),
      policy: row.policy ? JSON.parse(row.policy) : null,
      hasActiveTurns: Boolean(
        this.db
          .prepare("SELECT 1 FROM studio_turns WHERE threadId=? AND status IN ('queued','running') LIMIT 1")
          .get(id)
      ),
      tasks: includeTasks
        ? (
            this.db
              .prepare(
                'SELECT ' +
                  turnColumns +
                  " FROM studio_turns WHERE threadId=? AND kind='task' ORDER BY seq DESC LIMIT 32"
              )
              .all(id) as StoredTurn[]
          ).map(publicTurn)
        : [],
    };
  }
  /** Bodies are available by shared turn ID. Routine polling reads only the inbox index and summaries. */
  sharedOverview(id: string) {
    return {
      ...this.roomDetails(id),
      tasks: this.db
        .prepare(
          "SELECT id,memberId,status,substr(prompt,1,160) AS title FROM studio_turns WHERE threadId=? AND kind='task' AND shared=1 ORDER BY seq DESC LIMIT 32"
        )
        .all(id),
      messages: this.recentShared(id),
    };
  }
  note(id: string, authorId: string | null, input: StudioNoteInput): StudioNote {
    return this.transaction(() => {
      this.policy(id);
      const present = this.db
        .prepare('SELECT revision FROM studio_notes WHERE threadId=? AND key=?')
        .get(id, input.key) as { revision: number } | undefined;
      if ((present?.revision ?? 0) !== input.revision)
        throw Error('Memory changed. Read its current revision before writing.');
      if (
        !present &&
        (this.db.prepare('SELECT count(*) n FROM studio_notes WHERE threadId=?').get(id) as { n: number }).n >= 32
      )
        throw Error('Team memory is full. Update an existing entry.');
      const value = {
        key: input.key,
        text: input.text,
        revision: input.revision + 1,
        authorId,
        updatedAt: this.clock(),
      };
      this.db
        .prepare(
          'INSERT INTO studio_notes(threadId,key,text,revision,authorId,updatedAt) VALUES(?,?,?,?,?,?) ON CONFLICT(threadId,key) DO UPDATE SET text=excluded.text, revision=excluded.revision,authorId=excluded.authorId,updatedAt=excluded.updatedAt'
        )
        .run(id, value.key, value.text, value.revision, authorId, value.updatedAt);
      this.touch(id);
      return value;
    });
  }
  propose(id: string, proposalId: string, authorId: string, definition: FlowDefinition) {
    const createdAt = this.clock();
    this.db
      .prepare('INSERT INTO studio_flow_proposals(threadId,id,name,authorId,createdAt,definition) VALUES(?,?,?,?,?,?)')
      .run(id, proposalId, definition.name, authorId, createdAt, JSON.stringify(definition));
    this.touch(id);
    return { id: proposalId, name: definition.name, authorId, createdAt };
  }
  proposal(id: string, proposalId: string): FlowDefinition {
    const row = this.db
      .prepare('SELECT definition FROM studio_flow_proposals WHERE threadId=? AND id=?')
      .get(id, proposalId) as { definition: string } | undefined;
    if (!row) throw Error('Proposal unavailable in this team');
    return JSON.parse(row.definition);
  }
  recentShared(id: string) {
    return this.db
      .prepare(
        'SELECT id,memberId,authorId,kind,status,substr(prompt,1,160) AS title FROM studio_turns WHERE threadId=? AND shared=1 ORDER BY seq DESC LIMIT 16'
      )
      .all(id);
  }
  publicTurn(id: string, turnId: string) {
    const turn = this.db
      .prepare('SELECT ' + turnColumns + ' FROM studio_turns WHERE threadId=? AND id=? AND shared=1')
      .get(id, turnId) as StoredTurn | undefined;
    if (!turn) throw Error('This turn is outside the shared room history');
    return publicTurn(turn);
  }
  active(connection: string, id: string): StudioPrincipalTurn {
    const row = this.db
      .prepare(
        "SELECT id,threadId,memberId,rootId,session FROM studio_turns WHERE connection=? AND id=? AND status='running' AND shared=1"
      )
      .get(connection, id) as StudioPrincipalTurn | undefined;
    if (!row) throw Error('Team tools require an active turn');
    return row;
  }
  cancelBranch(threadId: string, id: string) {
    // Retire the synthesis wait as well as queued and running descendants in the caller's transaction.
    const branch = `WITH RECURSIVE branch(id) AS (
      SELECT id FROM studio_turns WHERE threadId=? AND id=?
      UNION ALL SELECT t.id FROM studio_turns t JOIN branch b ON b.id=t.originId WHERE t.threadId=?
    ) `;
    this.db
      .prepare(branch + 'DELETE FROM studio_gathers WHERE originId IN (SELECT id FROM branch)')
      .run(threadId, id, threadId);
    this.db
      .prepare(
        branch +
          "UPDATE studio_turns SET status='cancelled',session=NULL WHERE id IN (SELECT id FROM branch) AND status IN ('queued','running')"
      )
      .run(threadId, id, threadId);
  }
  receipt(originId: string, id: string, request: string, work: () => unknown) {
    return this.transaction(() => {
      const receipt = this.db
        .prepare('SELECT request,result FROM studio_tool_receipts WHERE originId=? AND id=?')
        .get(originId, id) as { request: string; result: string } | undefined;
      if (receipt) {
        if (receipt.request !== request) throw Error('Request identity already used');
        return JSON.parse(receipt.result);
      }
      if (
        (this.db.prepare('SELECT count(*) n FROM studio_tool_receipts WHERE originId=?').get(originId) as { n: number })
          .n >= 64
      )
        throw Error('Turn tool budget exhausted');
      const result = work();
      this.db
        .prepare('INSERT INTO studio_tool_receipts VALUES(?,?,?,?)')
        .run(originId, id, request, JSON.stringify(result));
      return result;
    });
  }
  /** An admission belongs to the original room and command even after the member leaves. */
  addressedPost(scope: StudioScope, post: StudioPost, origin?: StudioPrincipalTurn) {
    const row = this.db
      .prepare(
        `SELECT room.stack, t.id, (t.shared=1 AND t.memberId=? AND t.authorId IS ? AND
          t.originId IS ? AND t.kind=? AND t.prompt=?) AS matches
         FROM studio_threads room LEFT JOIN studio_turns t ON t.threadId=room.id AND t.id=?
         WHERE room.id=? AND room.account=? AND room.project=? AND room.directory=?`
      )
      .get(
        post.memberId,
        origin?.memberId ?? null,
        origin?.id ?? null,
        post.kind,
        post.text,
        post.turnId,
        post.threadId,
        scope.account,
        scope.project,
        scope.directory
      ) as { stack: string | null; id: string | null; matches: number | null } | undefined;
    if (!row) throw Error('Conversation unavailable in this workspace');
    if (row.id !== null && !row.matches) throw Error('Turn identity already used for a different request');
    return {
      stack: row.stack,
      receipt: row.id === null ? null : { threadId: post.threadId, turnId: post.turnId },
    };
  }
  enqueue(
    scope: StudioScope,
    post: StudioPost,
    session: string | null,
    origin?: StudioPrincipalTurn,
    beforeEnqueue?: () => void
  ) {
    return this.transaction(() => {
      const { receipt } = this.addressedPost(scope, post, origin);
      if (receipt) return receipt;
      const policy = this.policy(post.threadId);
      const target = this.member(post.threadId, post.memberId);
      const authorId = origin?.memberId ?? null;
      const originId = origin?.id ?? null;
      const rootId = origin?.rootId ?? post.turnId;
      if (
        this.db
          .prepare(
            'SELECT 1 FROM studio_withdrawn WHERE account=? AND project=? AND directory=? AND threadId=? AND turnId=?'
          )
          .get(scope.account, scope.project, scope.directory, post.threadId, post.turnId)
      )
        throw Error('This request was withdrawn');
      if (origin) {
        if (origin.threadId !== post.threadId || origin.memberId === post.memberId)
          throw Error('Address another member of the current team');
        if (post.kind === 'task' && origin.memberId !== post.threadId) throw Error('Only the lead can assign work');
        const count = this.db
          .prepare("SELECT count(*) n FROM studio_turns WHERE rootId=? AND authorId IS NOT NULL AND kind<>'summary'")
          .get(rootId) as { n: number };
        if (count.n >= policy.maxDelegations) throw Error('This operator request has reached its delegation budget');
      }
      const link = this.db
        .prepare(
          'SELECT id FROM studio_connections WHERE account=? AND project=? AND directory=? AND provider=? AND expires>?'
        )
        .get(scope.account, scope.project, scope.directory, target.provider, this.clock()) as
        { id: string } | undefined;
      if (!link) throw Error('Connect the selected member’s adapter before submitting work');
      if (
        (
          this.db
            .prepare("SELECT count(*) n FROM studio_turns WHERE connection=? AND status IN ('queued','running')")
            .get(link.id) as { n: number }
        ).n >= 16
      )
        throw Error('The connector queue is full');
      beforeEnqueue?.();
      const added = this.db
        .prepare(
          "INSERT INTO studio_turns(id,threadId,memberId,authorId,originId,rootId,kind,shared,connection,session,prompt,status,createdAt) VALUES(?,?,?,?,?,?,?,1,?,?,?,'queued',?) ON CONFLICT(id) DO NOTHING"
        )
        .run(
          post.turnId,
          post.threadId,
          post.memberId,
          authorId,
          originId,
          rootId,
          post.kind,
          link.id,
          session,
          post.text,
          this.clock()
        );
      if (!added.changes) throw Error('Turn identity already used for a different request');
      if (origin && post.kind === 'task')
        this.db
          .prepare('INSERT OR IGNORE INTO studio_gathers VALUES(?,?,?,?)')
          .run(origin.id, rootId, post.threadId, session);
      this.touch(post.threadId);
      return { threadId: post.threadId, turnId: post.turnId };
    });
  }
  /** Enqueue one synthesis after the lead and all of its assigned workers reach a terminal state. */
  collect(connection: string) {
    this.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM studio_gathers WHERE EXISTS(SELECT 1 FROM studio_turns t WHERE t.id=studio_gathers.originId AND t.status IN ('failed','cancelled','interrupted'))"
        )
        .run();
      const ready = this.db
        .prepare(
          `SELECT g.*,t.memberId FROM studio_gathers g JOIN studio_threads h ON h.id=g.threadId
        JOIN studio_turns t ON t.id=g.originId JOIN studio_connections c ON c.id=? AND c.account=h.account AND c.project=h.project AND c.directory=h.directory AND c.provider=h.provider
        WHERE t.status='completed' AND NOT EXISTS(SELECT 1 FROM studio_turns child WHERE child.originId=g.originId AND child.kind='task' AND child.status IN ('queued','running'))
        AND (SELECT count(*) FROM studio_turns WHERE connection=c.id AND status IN ('queued','running'))<16
        ORDER BY t.seq LIMIT 1`
        )
        .get(connection) as (StudioPrincipalTurn & { originId: string }) | undefined;
      if (!ready) return;
      const children = this.db
        .prepare("SELECT id,memberId,status FROM studio_turns WHERE originId=? AND kind='task' ORDER BY seq")
        .all(ready.originId);
      const prompt =
        'Review these team assignments and report their results to the operator. Read shared results by turn ID.\n' +
        JSON.stringify(children);
      this.db
        .prepare(
          "INSERT INTO studio_turns(id,threadId,memberId,authorId,originId,rootId,kind,shared,connection,session,prompt,status,createdAt) VALUES(?,?,?,NULL,?,?,'summary',1,?,?,?,'queued',?)"
        )
        .run(
          randomUUID(),
          ready.threadId,
          ready.memberId,
          ready.originId,
          ready.rootId,
          connection,
          ready.session,
          prompt,
          this.clock()
        );
      this.db.prepare('DELETE FROM studio_gathers WHERE originId=?').run(ready.originId);
      this.touch(ready.threadId);
    });
  }
}
