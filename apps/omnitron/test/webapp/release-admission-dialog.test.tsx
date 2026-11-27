// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const rpc = vi.hoisted(() => ({ check: vi.fn(), list: vi.fn(), start: vi.fn(), progress: vi.fn(), refresh: vi.fn(), can: vi.fn() }));
vi.mock('src/auth/access', () => ({ useAccess: () => ({ can: rpc.can }) }));
vi.mock('src/netron/client', () => ({ invokeStackLifecycle: rpc.check, daemonClient: { invoke: rpc.refresh }, project: { getDeployProgress: rpc.progress } }));
vi.mock('src/netron/release-wire', () => ({ releaseApi: { list: rpc.list } }));
vi.mock('src/stores/project.store', () => {
  const state = {
    stacksByProject: { sample: [{ name: 'test', type: 'remote', status: 'running' }] },
    stackReadErrors: {}, startStack: rpc.start, fetchStacks: vi.fn(),
  };
  return { useProjectStore: (select: (value: typeof state) => unknown) => select(state) };
});
const { DeployReleaseDialog } = await import('../../webapp/src/components/deploy-release-dialog');
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('explains an additive history refusal before allowing a deployment', async () => {
  rpc.can.mockReturnValue(true);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValue({ ok: false, state: 'replacement-unavailable', because: 'Return release predates 003.sql',
    migrationHistory: { kind: 'added-migrations', total: 1, entries: ['003.sql'] } });
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'changed-release' } });
  expect(await screen.findByText(/test the candidate on an isolated copy/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Stop and deploy' })).toBeNull();
  expect(rpc.start).not.toHaveBeenCalled();
});

it('reads the explicit native verify run while keeping production deployment withheld', async () => {
  rpc.can.mockImplementation(permission => ['OmnitronProject.inspectFirstWrite', 'OmnitronProject.prepareRehearsal', 'OmnitronProject.rehearseMigrations'].includes(permission));
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValueOnce({ ok: false, state: 'replacement-unavailable', because: 'Unproven first write',
    migrationHistory: { kind: 'added-migrations', total: 1, entries: ['003.sql'] } });
  rpc.check.mockResolvedValueOnce({ writeAdmission: 'withheld', owner: { nodeId: 'source', phase: 'stopped', revision: 8,
    apps: [{ name: 'sample/prod/main', generation: 'launch-3', artifactSha256: 'a'.repeat(64) }] },
    physical: { state: 'verified-closed-copy', evidence: { verifyRunId: 'verify-id', sourceStop: 'exact-stop', receiver: { nodeId: 'replica' }, proofDigest: 'b'.repeat(64) } },
    missing: [{ authority: 'writer-fence', reason: 'Data owners have not fenced external writers.' }] });
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'new' } });
  const run = await screen.findByLabelText('Physical verify run ID (optional)');
  expect(rpc.check).toHaveBeenCalledTimes(1);
  fireEvent.change(run, { target: { value: 'verify-id' } });
  fireEvent.click(screen.getByRole('button', { name: 'Inspect first-write admission' }));
  expect(await screen.findByText(/Closed copy verified on replica at stop exact-stop/)).toBeTruthy();
  expect(screen.getByText(/Data owners have not fenced external writers/)).toBeTruthy();
  expect(rpc.check).toHaveBeenLastCalledWith('inspectFirstWrite', { project: 'sample', stack: 'test', release: 'new', verifyRunId: 'verify-id' });
  const plan = { operationId:'operation-id', digest:'a'.repeat(64), logicalBytes:40, manifestSha256:'b'.repeat(64), receiver:{nodeId:'replica'} };
  rpc.check.mockResolvedValueOnce({state:'awaiting-confirmation',plan});
  fireEvent.click(screen.getByRole('button', {name:'Review private data copies'}));
  const confirm = await screen.findByRole('button', {name:'Prepare reviewed private copies'});
  expect(rpc.check).toHaveBeenLastCalledWith('prepareRehearsal', {project:'sample',stack:'test',release:'new',verifyRunId:'verify-id',operationId:expect.any(String)});
  const confirmation = { project:'sample',stack:'test',release:'new',verifyRunId:'verify-id',operationId:plan.operationId,review:plan.digest };
  rpc.check.mockRejectedValueOnce(Error('Receiver acknowledgement lost'));
  fireEvent.click(confirm);
  await screen.findByText('Receiver acknowledgement lost');
  expect(rpc.check).toHaveBeenLastCalledWith('prepareRehearsal',confirmation);
  rpc.check.mockResolvedValueOnce({state:'prepared',plan,receipt:{ copies:[{tag:'postgres-data',device:'2',inode:'4',generation:'b'.repeat(64)}] }});
  fireEvent.click(confirm);
  await screen.findByText(/Private data pair prepared/);
  expect(rpc.check).toHaveBeenLastCalledWith('prepareRehearsal',confirmation);
  expect(screen.getByRole('button', { name: 'Deploy' }).hasAttribute('disabled')).toBe(true);
  const trial = { database:'ledger', archiveSha256:'f'.repeat(64), added:['002_capture'], digest:'e'.repeat(64) };
  const request = { project:'sample',stack:'test',release:'new',operationId:plan.operationId,app:'ledger' };
  fireEvent.change(screen.getByLabelText('Migration application'), {target:{value:'ledger'}});
  rpc.check.mockResolvedValueOnce({state:'awaiting-confirmation',plan:trial});
  fireEvent.click(screen.getByRole('button',{name:'Review migration rehearsal'}));
  const execute = await screen.findByRole('button',{name:'Run reviewed migrations on private copy'});
  expect(rpc.check).toHaveBeenLastCalledWith('rehearseMigrations',request);
  rpc.check.mockRejectedValueOnce(Error('Migration acknowledgement lost'));
  fireEvent.click(execute);
  await screen.findByText('Migration acknowledgement lost');
  expect(rpc.check).toHaveBeenLastCalledWith('rehearseMigrations',{...request,review:trial.digest});
  rpc.check.mockResolvedValueOnce({state:'verified',plan:trial,receipt:{after:[{name:'002_capture'}]}});
  fireEvent.click(screen.getByRole('button',{name:'Read migration rehearsal'}));
  await screen.findByText(/Verified 1 migrations/);
  expect(rpc.check).toHaveBeenLastCalledWith('rehearseMigrations',request);
  expect(screen.queryByRole('button',{name:'Run reviewed migrations on private copy'})).toBeNull();
  fireEvent.change(run, { target: { value: 'another-id' } });
  expect(screen.queryByText(/Closed copy verified/)).toBeNull();
  expect(rpc.start).not.toHaveBeenCalled();
});

it('discards an unfinished first-write inspection when the operator selects another release', async () => {
  rpc.can.mockReturnValue(true);
  rpc.list.mockResolvedValue({ releases: [] });
  const refused = { ok: false, state: 'replacement-unavailable', because: 'Return unavailable',
    migrationHistory: { kind: 'added-migrations', total: 1, entries: ['002.sql'] } };
  let finish!: (value: unknown) => void;
  rpc.check.mockImplementation(method => method === 'checkRelease' ? Promise.resolve(refused) : new Promise(resolve => { finish = resolve; }));
  render(renderRelease());
  const release = screen.getByRole('combobox', { name: 'Release ID' });
  fireEvent.change(release, { target: { value: 'first' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect first-write admission' }));
  fireEvent.change(release, { target: { value: 'second' } });
  await screen.findByRole('button', { name: 'Inspect first-write admission' });
  finish({ writeAdmission: 'withheld', owner: { nodeId: 'former-owner', apps: [] }, physical: { state: 'unverified', reason: 'former result' }, missing: [] });
  await waitFor(() => expect(rpc.check).toHaveBeenCalledWith('checkRelease', { project: 'sample', stack: 'test', release: 'second' }));
  expect(screen.queryByText('former result')).toBeNull();
  expect(screen.getByRole('button', { name: 'Deploy' }).hasAttribute('disabled')).toBe(true);
  expect(rpc.start).not.toHaveBeenCalled();
});

it.each([true, false])('uses the reviewed node and checks the administrator grant before a full stop (allowed=%s)', async allowed => {
  const digest = 'a'.repeat(64);
  rpc.can.mockImplementation((permission: string) => permission === 'OmnitronProject.deployReviewedRelease' && allowed);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.progress.mockResolvedValue([]);
  rpc.check.mockResolvedValue({ ok: true, deployment: { digest, nodeId: 'receiver', rollback: { release: 'previous-release' },
    stop: { applications: ['main'], containers: ['db'] } } });
  rpc.start.mockResolvedValue({ state: 'confirmed' });
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'second-release' } });
  const apply = await screen.findByRole('button', { name: 'Stop and deploy' });
  expect(screen.getByText('receiver')).toBeTruthy();
  expect(screen.getByText(/Verified return release.*previous-release/)).toBeTruthy();
  expect(apply.hasAttribute('disabled')).toBe(!allowed);
  expect(rpc.start).not.toHaveBeenCalled();
  fireEvent.click(apply);
  if (allowed) {
    await waitFor(() => expect(rpc.start).toHaveBeenCalledExactlyOnceWith('sample', 'test',
      { release: 'second-release', deploymentReview: digest }));
  } else {
    expect(screen.getByText(/administrator must confirm/i)).toBeTruthy();
    expect(rpc.start).not.toHaveBeenCalled();
  }
});

it('accepts an external release ID, fetches on request and requires a separate deployment action', async () => {
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.progress.mockResolvedValue([]);
  rpc.check.mockResolvedValueOnce({ ok: false, state: 'missing', because: 'Release is absent from this controller' });
  let confirm!: (reply: { ok: boolean; because: string }) => void;
  rpc.check.mockReturnValueOnce(new Promise(resolve => { confirm = resolve; }));
  render(<MemoryRouter><DeployReleaseDialog open onClose={vi.fn()} project="sample" stack="test" release={null} /></MemoryRouter>);
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  const fetch = await screen.findByRole('button', { name: 'Fetch and verify' });
  expect(rpc.check).toHaveBeenCalledWith('checkRelease', { project: 'sample', stack: 'test', release: 'sample-123' });
  fireEvent.click(fetch);
  expect(screen.getByRole('status').textContent).toContain('Preparing');
  expect(rpc.check).toHaveBeenLastCalledWith('checkRelease', { project: 'sample', stack: 'test', release: 'sample-123', prepare: true });
  confirm({ ok: true, because: 'Ready for test' });
  const deploy = await screen.findByRole('button', { name: 'Deploy' });
  expect(deploy.hasAttribute('disabled')).toBe(false);
  expect(rpc.start).not.toHaveBeenCalled();
  rpc.start.mockResolvedValue({ state: 'failed', message: 'Node unreachable' });
  fireEvent.click(deploy);
  await waitFor(() => expect(rpc.start).toHaveBeenCalledWith('sample', 'test', { release: 'sample-123' }));
  expect(await screen.findByText('Node unreachable')).toBeTruthy();
});

it('reopens a pending deployment with the original confirmation', async () => {
  const digest = 'd'.repeat(64);
  rpc.can.mockReturnValue(true);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.progress.mockResolvedValue([]);
  rpc.check.mockResolvedValue({ ok: true, deploymentPhase: 'starting', deployment: {
    digest, nodeId: 'receiver', rollback: { release: 'previous' }, stop: { applications: ['main'], containers: [] },
  } });
  rpc.start.mockResolvedValue({ state: 'confirmed' });
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'second' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Continue deployment' }));
  await waitFor(() => expect(rpc.start).toHaveBeenCalledExactlyOnceWith('sample', 'test', { release: 'second', deploymentReview: digest }));
});

const requiresDeclarations = {
  ok: false, state: 'requires-stop', declarations: 'refresh-required', because: 'The target is running',
  declarationReason: 'Verified declarations are missing for app api.',
};
const renderRelease = (project = 'sample') => <MemoryRouter><DeployReleaseDialog open onClose={vi.fn()} project={project} stack="test" release={null} /></MemoryRouter>;

it('lets an authorized operator refresh the exact release before reviewing the running target', async () => {
  rpc.can.mockImplementation(permission => permission === 'OmnitronProject.refreshTopologyMetadata');
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValueOnce(requiresDeclarations).mockResolvedValueOnce({ ok: false, state: 'requires-stop', because: 'Ready after reviewed stop' });
  rpc.refresh.mockResolvedValue({ refreshed: 1, failures: [] });
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Update declarations…' }));
  expect(rpc.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Update declarations' }));
  expect(await screen.findByText('Ready after reviewed stop')).toBeTruthy();
  expect(rpc.refresh).toHaveBeenCalledWith('daemon', 'OmnitronProject', 'refreshTopologyMetadata',
    [{ project: 'sample', stack: 'test', release: 'sample-123' }], { timeout: 120_000 });
  expect(rpc.check.mock.calls).toEqual(Array(2).fill(['checkRelease', { project: 'sample', stack: 'test', release: 'sample-123' }]));
  expect(screen.queryByRole('button', { name: 'Update declarations…' })).toBeNull();
  // The updated verdict arrives before the nested confirmation dialog releases
  // its modal focus boundary. Wait for the parent action to be accessible.
  expect((await screen.findByRole('link', { name: 'Inspect stack' })).hasAttribute('disabled')).toBe(false);
  expect(rpc.start).not.toHaveBeenCalled();
});

it('explains the exact grant needed and keeps a running stack inspectable for an ordinary operator', async () => {
  rpc.can.mockReturnValue(false);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValue(requiresDeclarations);
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  expect(await screen.findByText(/An administrator must update/)).toBeTruthy();
  expect(screen.getByText(requiresDeclarations.declarationReason)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Update declarations…' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Inspect stack' }).hasAttribute('disabled')).toBe(false);
  expect(rpc.start).not.toHaveBeenCalled();
  expect(rpc.refresh).not.toHaveBeenCalled();
});

it('discards a release declaration reply after the workspace changes', async () => {
  rpc.can.mockReturnValue(true);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.check.mockResolvedValueOnce(requiresDeclarations).mockResolvedValue({ ok: true, because: 'Ready for second project' });
  let finish!: (result: { refreshed: number; failures: [] }) => void;
  rpc.refresh.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'sample-123' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Update declarations…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Update declarations' }));
  rerender(renderRelease('second'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'second-123' } });
  expect(await screen.findByText('Ready for second project')).toBeTruthy();
  finish({ refreshed: 1, failures: [] });
  await waitFor(() => expect(screen.queryByText('The target is running')).toBeNull());
  expect(rpc.check.mock.calls.filter(([, input]) => input.project === 'sample')).toHaveLength(1);
  expect(rpc.start).not.toHaveBeenCalled();
});

it.each([false, true])('confirms the exact qualified recovery from the review (reopened=%s)', async reopened => {
  const digest = 'd'.repeat(64);
  const recovery = { release: 'compatible', runId: '31f297a8-93eb-455f-8267-19cdf415bd3f', probeCommit: 'b'.repeat(40) };
  rpc.can.mockReturnValue(true);
  rpc.list.mockResolvedValue({ releases: [] });
  rpc.progress.mockResolvedValue([]);
  rpc.start.mockResolvedValue({ state: 'confirmed' });
  if (!reopened) rpc.check.mockResolvedValueOnce({ ok: false, state: 'replacement-unavailable', because: 'Choose a compatible return release',
    migrationHistory: { kind: 'added-migrations', total: 1, entries: ['003.sql'] } });
  rpc.check.mockResolvedValue({ ok: true, ...(reopened && { deploymentPhase: 'starting' }), deployment: {
    digest, nodeId: 'receiver', stop: { applications: ['ledger'], containers: [] }, rollback: { release: recovery.release },
    postWriteRecovery: { incumbent: { release: 'previous' }, runId: recovery.runId, probeCommit: recovery.probeCommit, proofDigest: 'c'.repeat(64) },
  } });
  render(renderRelease());
  fireEvent.change(screen.getByRole('combobox', { name: 'Release ID' }), { target: { value: 'candidate' } });
  if (!reopened) {
    fireEvent.change(await screen.findByLabelText('Recovery release ID'), { target: { value: recovery.release } });
    const review = screen.getByRole('button', { name: 'Review recovery release' });
    expect(review.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Recovery qualification run ID'), { target: { value: recovery.runId } });
    fireEvent.change(screen.getByLabelText('Recovery probe commit'), { target: { value: recovery.probeCommit } });
    fireEvent.click(review);
  }
  expect(await screen.findByText('Verified return release · compatible')).toBeTruthy();
  expect(screen.getByText('Currently selected release · previous')).toBeTruthy();
  expect(screen.getByText(new RegExp(recovery.runId))).toBeTruthy();
  if (!reopened) expect(rpc.check).toHaveBeenLastCalledWith('checkRelease', { project: 'sample', stack: 'test', release: 'candidate', recovery });
  expect(rpc.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: reopened ? 'Continue deployment' : 'Stop and deploy' }));
  await waitFor(() => expect(rpc.start).toHaveBeenCalledExactlyOnceWith('sample', 'test', { release: 'candidate', deploymentReview: digest, recovery }));
});
