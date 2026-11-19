import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { StudioLedger } from '../../src/studio/ledger.js';
import { FlowLedger } from '../../src/flows/flow-ledger.js';
import {
  controllerJournalNeeds,
  assertControllerJournals,
  sourceControllerJournalCheck,
} from '../../src/daemon/controller-journal-compatibility.js';
import { assertOperationJournalCompatibility } from '../../src/execution/operation-journal.js';
import { RuntimeInstallation } from '../../src/daemon/runtime-installation.js';
import formats from '../../src/shared/controller-journal-formats.json' with { type: 'json' };
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import type { StudioTeamPolicy, StudioSend } from '../../src/shared/dto/studio.js';
import type { FlowDefinition } from '../../src/shared/dto/flows.js';

const baseline = '6c98e39f8dd5c8a05a06f714f8651c20696db31f';
const clock = () => 1000;
const scope = { account: 'fixture', project: 'library', directory: '/fixture/library' };
const policy: StudioTeamPolicy = {
  providers: ['codex', 'claude'],
  maxMembers: 4,
  maxDelegations: 3,
  maxCostTier: 'premium',
};
const preferences: StudioSend['preferences'] = { role: 'engineer', result: 'patch', requirements: {} };
const assignment = () => JSON.stringify({ requestKey: 'fixture', preferences, selection: {} });
const clean: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const release of clean.splice(0).reverse()) await release();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'controller-format-'));
  clean.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'data'));
  const file = path.join(root, 'data/daemon-state.db');
  function open(fileName = file) {
    const db = new Database(fileName);
    clean.push(() => {
      if (db.open) db.close();
    });
    return db;
  }
  const oldDir = process.env['OMNITRON_TEST_STUDIO_PREVIOUS_DIST'];
  async function legacy(skip: (reason: string) => never): Promise<typeof StudioLedger> {
    if (oldDir) {
      const stamp = JSON.parse(await readFile(path.join(oldDir, 'BUILD.json'), 'utf8'));
      expect(stamp).toMatchObject({ commit: baseline, dirty: false });
      return (await import(/* @vite-ignore */ pathToFileURL(path.join(oldDir, 'studio/ledger.js')).href)).StudioLedger;
    }
    // The historical ledger imports only node:crypto at runtime. Vitest compiles the exact Git source.
    const source = spawnSync('git', ['show', baseline + ':apps/omnitron/src/studio/ledger.ts'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
    });
    if (source.status !== 0) skip('Supply OMNITRON_TEST_STUDIO_PREVIOUS_DIST or the Git history for ' + baseline);
    const entry = path.join(root, 'previous-studio-ledger.ts');
    await writeFile(entry, source.stdout);
    return (await import(/* @vite-ignore */ pathToFileURL(entry).href)).StudioLedger;
  }
  const previous = oldDir ?? path.join(root, 'previous');
  const currentBuild = process.env['OMNITRON_TEST_STUDIO_CURRENT_DIST'];
  const compatible = currentBuild ?? path.join(root, 'compatible');
  let CurrentStudio = StudioLedger,
    CurrentFlows = FlowLedger;
  if (currentBuild) {
    CurrentStudio = (await import(/* @vite-ignore */ pathToFileURL(path.join(currentBuild, 'studio/ledger.js')).href))
      .StudioLedger;
    CurrentFlows = (
      await import(/* @vite-ignore */ pathToFileURL(path.join(currentBuild, 'flows/flow-ledger.js')).href)
    ).FlowLedger;
  } else {
    await mkdir(path.join(compatible, 'shared'), { recursive: true });
    await writeFile(path.join(compatible, 'shared/controller-journal-formats.json'), JSON.stringify(formats));
  }
  const db = open();
  db.exec('CREATE TABLE state_kv(key TEXT PRIMARY KEY,value TEXT)');
  return { root, db, open, legacy, previous, compatible, CurrentStudio, CurrentFlows };
}
const send = (studio: StudioLedger, threadId: string, prompt: string) => {
  const turnId = randomUUID();
  studio.send(
    scope,
    {
      project: scope.project,
      provider: 'codex',
      threadId,
      turnId,
      after: null,
      prompt,
      preferences,
      requestKey: 'fixture',
    },
    null,
    assignment
  );
  return turnId;
};
function complete(studio: StudioLedger, connection: string, id: string, conversation: string) {
  expect(studio.claim(connection, id)).toBe(true);
  studio.finish(connection, id, { status: 'completed', answer: 'fixture answer', conversation });
}
function indexes(db: Database.Database) {
  return db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='index' AND name IN ('studio_active_turn','studio_active_connector') ORDER BY name"
    )
    .all();
}

it('round-trips a physical 6c98 solo journal and refuses its legacy receiver after the room becomes shared', async ({
  skip,
}) => {
  const f = await fixture(),
    room = randomUUID(),
    peer = randomUUID();
  const Legacy = await f.legacy(skip);
  const old = new Legacy(f.db, clock),
    leadLink = old.connect(scope, 'codex', '[]');
  const solo = send(old, room, 'individual work');
  complete(old, leadLink, solo, 'fixture-solo');
  expect(indexes(f.db)).toHaveLength(2);
  f.db.close();
  let db = f.open(),
    current = new f.CurrentStudio(db, clock);
  expect(indexes(db)).toHaveLength(0);
  expect(current.thread(scope, room).turns).toMatchObject([{ id: solo, memberId: room, answer: 'fixture answer' }]);
  await assertOperationJournalCompatibility(f.root, f.previous);
  const safeCopy = path.join(f.root, 'safe.db');
  await db.backup(safeCopy);
  const safe = f.open(safeCopy);
  expect(new Legacy(safe, clock).thread(scope, room).turns).toMatchObject([{ id: solo, answer: 'fixture answer' }]);
  expect(indexes(safe)).toHaveLength(2);
  current.teams.configure(scope, room, policy, null);
  current.teams.invite(room, peer, 'Reviewer', 'claude', assignment());
  const peerLink = current.connect(scope, 'claude', '[]');
  const post = (memberId: string) => {
    const turnId = randomUUID();
    current.teams.enqueue(
      scope,
      { project: scope.project, threadId: room, turnId, memberId, kind: 'message', text: 'shared work' },
      null
    );
    return turnId;
  };
  const lead = post(room);
  expect(current.pending(leadLink)?.conversation).toBe(null);
  complete(current, leadLink, lead, 'fixture-team-lead');
  const firstPeer = post(peer);
  expect(current.pending(peerLink)?.conversation).toBe(null);
  complete(current, peerLink, firstPeer, 'fixture-peer');
  db.close();
  db = f.open();
  current = new f.CurrentStudio(db, clock);
  const queued = post(peer);
  expect(current.pending(peerLink)).toMatchObject({ id: queued, memberId: peer, conversation: 'fixture-peer' });
  await expect(assertOperationJournalCompatibility(f.root, f.previous)).rejects.toThrow('Studio team');
  await expect(sourceControllerJournalCheck(f.root)()).rejects.toThrow('verified destination');
  await assertOperationJournalCompatibility(f.root, f.compatible);
  const unsafe = path.join(f.root, 'unsafe.db');
  await db.backup(unsafe);
  const wrong = f.open(unsafe),
    fallback = new Legacy(wrong, clock);
  expect(fallback.pending(peerLink)).toMatchObject({ id: queued, conversation: 'fixture-team-lead' });
  complete(fallback, peerLink, queued, 'fixture-wrong-owner');
  expect(wrong.prepare('SELECT conversation FROM studio_threads WHERE id=?').get(room)).toEqual({
    conversation: 'fixture-wrong-owner',
  });
  post(room);
  const busy = path.join(f.root, 'busy.db');
  await db.backup(busy);
  expect(() => new Legacy(f.open(busy), clock)).toThrow('UNIQUE constraint failed: studio_turns.threadId');
  expect(indexes(db)).toHaveLength(0);
  expect(current.thread(scope, room).turns.some((t) => t.id === solo)).toBe(true);
});

it('detects parallel solo work before a legacy boot can partially recreate its indexes', async ({ skip }) => {
  const f = await fixture();
  const Legacy = await f.legacy(skip);
  const studio = new f.CurrentStudio(f.db, clock),
    link = studio.connect(scope, 'codex', '[]', 2);
  for (let i = 0; i < 2; i++) expect(studio.claim(link, send(studio, randomUUID(), 'work ' + i))).toBe(true);
  expect(controllerJournalNeeds(f.db)).toMatchObject({ teamRooms: false, concurrentTurns: true });
  await expect(assertOperationJournalCompatibility(f.root, f.previous)).rejects.toThrow('concurrent turns');
  expect(indexes(f.db)).toEqual([]);
  const copy = path.join(f.root, 'connector.db');
  await f.db.backup(copy);
  const branch = f.open(copy);
  expect(() => new Legacy(branch, clock)).toThrow('UNIQUE constraint failed: studio_turns.connection');
  expect(indexes(branch)).toEqual([{ name: 'studio_active_turn' }]);
});

it('allows inactive flow drafts and retained receipts, while checking active graphs and undelivered work separately', async () => {
  const f = await fixture(),
    ledger = new f.CurrentFlows(f.db),
    scope = { workspace: { project: null }, id: randomUUID() };
  const binding = { identity: 'fixture', target: null },
    actor = { actor: 'fixture', session: null };
  const definition: FlowDefinition = {
    version: 1,
    name: 'Fixture',
    nodes: [
      { id: 'input', type: 'input.manual@1', config: {} },
      { id: 'review', type: 'output.pipeline@1', config: { pipelineId: 'fixture', revision: 'f'.repeat(64) } },
    ],
    edges: [{ from: 'input', port: 'event', to: 'review' }],
  };
  const draft = ledger.save({ ...scope, definition, expectedRevision: null }, binding);
  await assertOperationJournalCompatibility(f.root, f.previous);
  const gate = sourceControllerJournalCheck(f.root);
  await gate();
  const active = ledger.change({ ...scope, revision: draft.revision, activation: null }, actor, binding).active!;
  await expect(gate()).rejects.toThrow('verified destination');
  await expect(assertOperationJournalCompatibility(f.root, f.previous)).rejects.toThrow('active flows');
  const receipt = ledger.submit(scope, active.id, { id: 'record', source: 'input', type: 'manual', data: {} });
  expect(controllerJournalNeeds(f.db)).toMatchObject({ activeFlows: true, pendingDeliveries: true });
  await assertOperationJournalCompatibility(f.root, f.compatible);
  await expect(
    assertControllerJournals({ ...controllerJournalNeeds(f.db), activeFlows: false }, f.previous)
  ).rejects.toThrow('pending deliveries');
  ledger.change({ ...scope, revision: draft.revision, activation: active.id }, actor, null);
  await assertOperationJournalCompatibility(f.root, f.previous);
  expect(ledger.history(scope)[0]?.deliveries[0]).toMatchObject({
    id: receipt.deliveries[0]?.id,
    status: 'needs-review',
  });
});

it('rechecks the sealed destination at handoff without starting a process or changing the selection', async () => {
  const f = await fixture();
  const studio = new f.CurrentStudio(f.db, clock);
  const link = studio.connect(scope, 'codex', '[]');
  const room = randomUUID();
  complete(studio, link, send(studio, room, 'fixture'), 'fixture-solo');
  const staging = path.join(f.root, 'sealed');
  await mkdir(path.join(staging, 'packages/0/dist/shared'), { recursive: true });
  const declaration = 'packages/0/dist/shared/controller-journal-formats.json';
  await cp(path.join(f.compatible, 'shared/controller-journal-formats.json'), path.join(staging, declaration));
  const hash = await runtimeArtifactDigest(staging);
  await writeFile(
    path.join(staging, 'RUNTIME.json'),
    JSON.stringify({
      protocol: 1,
      sha256: hash,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      packages: 1,
    })
  );
  const installation = (await RuntimeInstallation.open(f.root))!;
  clean.push(() => installation.close());
  const root = installation.releasePath(hash);
  await rename(staging, root);
  const checked = sourceControllerJournalCheck(f.root, hash);
  await checked();
  studio.teams.configure(scope, room, policy, null);
  await checked();
  await checked();
  expect(installation.selection()).toBeNull();
  await writeFile(path.join(root, declaration), '{}');
  await expect(checked()).rejects.toThrow(/changed/);
  expect(indexes(f.db)).toEqual([]);
});

it('requires only the journal formats actually in use, and only at a supported version', async () => {
  const f = await fixture(),
    target = path.join(f.root, 'partial');
  await mkdir(path.join(target, 'shared'), { recursive: true });
  await writeFile(
    path.join(target, 'shared/controller-journal-formats.json'),
    JSON.stringify({ studioTeams: formats.studioTeams, hostFlows: 999 })
  );
  const teams = { teamRooms: true, concurrentTurns: false, activeFlows: false, pendingDeliveries: false };
  await assertControllerJournals(teams, target);
  await expect(assertControllerJournals({ ...teams, activeFlows: true }, target)).rejects.toThrow('active flows');
});
