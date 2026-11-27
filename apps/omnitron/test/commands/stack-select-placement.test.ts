import { afterEach, expect, it, vi } from 'vitest';
import { stackPlanRecoveryCommand, stackPrepareRehearsalCommand, stackRehearseMigrationsCommand, stackReleaseAdmissionCommand, stackSelectPlacementCommand, stackStartCommand } from '../../src/commands/stack.js';

const rpc = vi.hoisted(() => ({
  preflightRemotePlacement: vi.fn(), reviewRemotePlacement: vi.fn(), selectRemotePlacement: vi.fn(),
  planRecoveryQualification: vi.fn(), checkRelease: vi.fn(), inspectFirstWrite: vi.fn(), prepareRehearsal: vi.fn(), rehearseMigrations: vi.fn(), startStack: vi.fn(), deployReviewedRelease: vi.fn(), reviewStackStart: vi.fn(),
}));
const client = vi.hoisted(() => ({ service: vi.fn(async () => rpc), disconnect: vi.fn() }));
const output = vi.hoisted(() => ({ emitJson: vi.fn(() => true), emitError: vi.fn(), emitInfo: vi.fn(), emitStep: vi.fn(), isJsonMode: () => true }));
vi.mock('../../src/daemon/daemon-client.js', async original => ({
  ...await original<typeof import('../../src/daemon/daemon-client.js')>(), createDaemonClient: () => client,
}));
vi.mock('../../src/commands/output.js', () => output);

const options = { fromNode: 'receiver', release: 'release-2', prepared: 'a'.repeat(64), previousDeclarationCommit: 'b'.repeat(40) };
const request = { project: 'sample', stack: 'prod', fromNodeId: options.fromNode, previousDeclarationCommit: options.previousDeclarationCommit,
  destination: { release: options.release, prepared: options.prepared } };
const exitCode = process.exitCode;
afterEach(() => { vi.clearAllMocks(); process.exitCode = exitCode; });

it('reviews, runs and reads the same private migration operation using the ordinary CLI', async () => {
  const operation = 'caf62778-98cc-4841-bea1-f0626e0c234a', review = 'b'.repeat(64), app = 'ledger';
  const input = { project: 'fixture', stack: 'cold', release: 'candidate', operationId: operation, app };
  for (const state of ['awaiting-confirmation', 'unconfirmed', 'verified']) {
    const reply = { state, writeAdmission: 'withheld', ...(state === 'verified' && { receipt: { after: [{name:'002_capture'}] } }) };
    rpc.rehearseMigrations.mockResolvedValueOnce(reply);
    const confirmation = state === 'unconfirmed' ? {review} : {};
    await stackRehearseMigrationsCommand('fixture', 'cold', 'candidate', { operation, app, ...confirmation });
    expect(rpc.rehearseMigrations).toHaveBeenLastCalledWith({ ...input, ...confirmation });
    expect(output.emitJson).toHaveBeenLastCalledWith(reply);
    if (state === 'unconfirmed') expect(process.exitCode).toBe(1);
  }
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
  expect(rpc.startStack).not.toHaveBeenCalled();
});

it('previews private rehearsal data and keeps the operation identifier on an ambiguous acknowledgement', async () => {
  const verifyRun = '90af71d8-df66-4b55-b8fa-d892f4411f0a', review = 'd'.repeat(64);
  rpc.prepareRehearsal.mockResolvedValueOnce({ state: 'awaiting-confirmation' });
  await stackPrepareRehearsalCommand('sample', 'prod', 'next', { verifyRun });
  const preview = rpc.prepareRehearsal.mock.calls[0]![0];
  expect(preview).toEqual({ project: 'sample', stack: 'prod', release: 'next', verifyRunId: verifyRun, operationId: expect.any(String) });
  expect(output.emitJson).toHaveBeenCalledWith({ state:'awaiting-confirmation' });
  await stackPrepareRehearsalCommand('sample', 'prod', 'next', { verifyRun, review });
  expect(rpc.prepareRehearsal).toHaveBeenCalledTimes(1);
  rpc.prepareRehearsal.mockRejectedValueOnce(Error('connection lost'));
  await stackPrepareRehearsalCommand('sample', 'prod', 'next', { verifyRun, operation: preview.operationId, review });
  expect(rpc.prepareRehearsal).toHaveBeenLastCalledWith({ ...preview, review });
  expect(output.emitError).toHaveBeenLastCalledWith(expect.stringContaining('connection lost'),
    { ...preview, outcome:'unconfirmed', writeAdmission:'withheld' });
  expect(rpc.startStack).not.toHaveBeenCalled();
});

it('reports a scoped preservation refusal to the operator and to a registering controller', async () => {
  rpc.startStack.mockRejectedValueOnce(Object.assign(Error('Review required'), { details: { reason: 'infrastructure-review-required', private: true } }));
  await stackStartCommand('sample', 'prod');
  expect(output.emitError).toHaveBeenCalledWith('Failed: Review required',
    { project: 'sample', stack: 'prod', outcome: 'refused', reason: 'infrastructure-review-required' });
  expect(process.exitCode).toBe(1);
});

it('passes preflight evidence through JSON and leaves review and selection untouched', async () => {
  const proof = { fromNodeId: 'receiver', toNodeId: 'receiver', source: { revision: 8 } };
  rpc.preflightRemotePlacement.mockResolvedValueOnce(proof);
  await stackSelectPlacementCommand('sample', 'prod', { ...options, preflight: true });
  expect(rpc.preflightRemotePlacement).toHaveBeenCalledWith(request);
  expect(output.emitJson).toHaveBeenCalledWith(proof);
  expect(rpc.reviewRemotePlacement).not.toHaveBeenCalled();
  expect(rpc.selectRemotePlacement).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledOnce();
});

it('rejects confirmation mixed with preflight before connecting', async () => {
  await stackSelectPlacementCommand('sample', 'prod', { ...options, preflight: true, review: 'c'.repeat(64) });
  expect(client.service).not.toHaveBeenCalled();
  expect(output.emitError).toHaveBeenCalledWith(expect.stringContaining('either preflight or confirmation'));
  expect(process.exitCode).toBe(1);
});

it('reports an unsupported preflight without invoking a post-stop operation', async () => {
  rpc.preflightRemotePlacement.mockRejectedValueOnce(Error('Unknown method'));
  await stackSelectPlacementCommand('sample', 'prod', { ...options, preflight: true });
  expect(output.emitError).toHaveBeenCalledWith('Unknown method');
  expect(output.emitJson).not.toHaveBeenCalled();
  expect(rpc.reviewRemotePlacement).not.toHaveBeenCalled();
  expect(rpc.selectRemotePlacement).not.toHaveBeenCalled();
});

it('uses one reviewed deployment from the ordinary start command and dry run', async () => {
  const digest = 'e'.repeat(64), input = { project: 'sample', stack: 'prod', release: 'release-2' };
  const admission = { ok: true, deployment: { digest, nodeId: 'receiver', rollback: { release: 'release-1' } } };
  rpc.checkRelease.mockResolvedValue(admission);
  await stackStartCommand(input.project, input.stack, { release: input.release, dryRun: true });
  expect(rpc.checkRelease).toHaveBeenCalledWith(input);
  expect(output.emitJson).toHaveBeenCalledWith(admission);
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
  rpc.deployReviewedRelease.mockResolvedValue({ status: 'running', apps: [{ name: 'main', status: 'online' }] });
  await stackStartCommand(input.project, input.stack, { release: input.release, deploymentReview: digest });
  expect(rpc.deployReviewedRelease).toHaveBeenCalledExactlyOnceWith({ ...input, review: digest });
  expect(rpc.startStack).not.toHaveBeenCalled();
  expect(rpc.reviewStackStart).not.toHaveBeenCalled();
  expect(output.emitError).not.toHaveBeenCalled();
});

it('keeps a refused replacement visible without issuing a preservation or start request', async () => {
  rpc.checkRelease.mockResolvedValue({ ok: false, state: 'replacement-unavailable', because: 'Missing return release' });
  await stackStartCommand('sample', 'prod', { release: 'release-2', dryRun: true });
  expect(process.exitCode).toBe(1);
  await stackStartCommand('sample', 'prod', { release: 'release-2', deploymentReview: 'f'.repeat(64), workingTree: true });
  expect(rpc.reviewStackStart).not.toHaveBeenCalled();
  expect(rpc.startStack).not.toHaveBeenCalled();
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
});

it('explains an additive-history refusal in check-release and preserves its evidence in a JSON dry run', async () => {
  const refusal = { ok: false, state: 'replacement-unavailable', because: 'The return release predates 002.sql',
    migrationHistory: { kind: 'added-migrations', total: 1, entries: ['002.sql'] } };
  rpc.checkRelease.mockResolvedValue(refusal);
  output.emitJson.mockReturnValueOnce(false);
  await stackReleaseAdmissionCommand('sample', 'prod', 'next', false);
  expect(output.emitInfo).toHaveBeenCalledWith(expect.stringMatching(/physical return point/));
  expect(process.exitCode).toBe(1);
  await stackStartCommand('sample', 'prod', { release: 'next', dryRun: true });
  expect(output.emitJson).toHaveBeenLastCalledWith(refusal);
  expect(rpc.startStack).not.toHaveBeenCalled();
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
});

it('returns a verified closed copy and a refused first write from the ordinary check-release command', async () => {
  const verifyRun = '205656dc-7e3f-4bc5-93f0-b51092e562f6';
  const result = { ok: false, writeAdmission: 'withheld', owner: {}, physical: { state: 'verified-closed-copy', evidence: { verifyRunId: verifyRun } } };
  rpc.inspectFirstWrite.mockResolvedValueOnce(result);
  await stackReleaseAdmissionCommand('sample', 'prod', 'next', false, { firstWrite: true, verifyRun });
  expect(rpc.inspectFirstWrite).toHaveBeenCalledExactlyOnceWith({ project: 'sample', stack: 'prod', release: 'next', verifyRunId: verifyRun });
  expect(output.emitJson).toHaveBeenCalledWith(result);
  expect(process.exitCode).toBe(1);
  await stackReleaseAdmissionCommand('sample', 'prod', 'next', false, { verifyRun });
  expect(rpc.inspectFirstWrite).toHaveBeenCalledTimes(1);
  rpc.inspectFirstWrite.mockRejectedValueOnce(Error('Receiver disconnected'));
  await stackReleaseAdmissionCommand('sample', 'prod', 'next', false, { firstWrite: true, verifyRun });
  expect(output.emitError).toHaveBeenLastCalledWith('First-write inspection unavailable. Receiver disconnected',
    { project: 'sample', stack: 'prod', release: 'next', outcome: 'unverified', writeAdmission: 'withheld' });
  expect(output.emitJson).toHaveBeenCalledTimes(1);
  expect(rpc.checkRelease).not.toHaveBeenCalled();
  expect(rpc.startStack).not.toHaveBeenCalled();
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
});

it('carries the qualified return and run through admission, dry run, continuation and confirmation', async () => {
  const recovery = { release: 'schema-compatible', runId: '31f297a8-93eb-455f-8267-19cdf415bd3f', probeCommit: 'a'.repeat(40) };
  const flags = { recoveryRelease: recovery.release, recoveryRun: recovery.runId, recoveryProbe: recovery.probeCommit };
  const scope = { project: 'sample', stack: 'prod', release: 'candidate' };
  const digest = 'b'.repeat(64);
  const admission = { ok: true, deployment: { digest, rollback: { release: recovery.release },
    postWriteRecovery: { incumbent: { release: 'incumbent' }, runId: recovery.runId, probeCommit: recovery.probeCommit, proofDigest: 'a'.repeat(64) } } };
  rpc.checkRelease.mockResolvedValue(admission);
  await stackReleaseAdmissionCommand(scope.project, scope.stack, scope.release, false, flags);
  expect(rpc.checkRelease).toHaveBeenLastCalledWith({ ...scope, prepare: false, recovery });
  const generated = expect.stringContaining('--recovery-release');
  expect(output.emitJson).toHaveBeenLastCalledWith(expect.objectContaining({ action: generated }));
  await stackStartCommand(scope.project, scope.stack, { release: scope.release, dryRun: true, ...flags });
  expect(rpc.checkRelease).toHaveBeenLastCalledWith({ ...scope, recovery });
  expect(output.emitJson).toHaveBeenLastCalledWith(expect.objectContaining({ action: expect.stringContaining(recovery.runId) }));
  // A fresh terminal can reopen the journal with just the target release.
  await stackStartCommand(scope.project, scope.stack, { release: scope.release, dryRun: true });
  expect(output.emitJson).toHaveBeenLastCalledWith(expect.objectContaining({ action: generated }));
  rpc.deployReviewedRelease.mockResolvedValue({ status: 'running', apps: [{ name: 'main', status: 'online' }] });
  await stackStartCommand(scope.project, scope.stack, { release: scope.release, deploymentReview: digest, ...flags });
  expect(rpc.deployReviewedRelease).toHaveBeenCalledExactlyOnceWith({ ...scope, review: digest, recovery });
  expect(rpc.startStack).not.toHaveBeenCalled();
});

it('refuses incomplete and mixed recovery options before requesting any lifecycle operation', async () => {
  const flags = { recoveryRelease: 'compatible', recoveryRun: 'd1dbed83-2652-4aeb-be5a-87d943d05b68', recoveryProbe: 'a'.repeat(40) };
  for (const extra of [{ firstWrite: true }, { prepared: 'a'.repeat(64) }, { source: '/source' }])
    await stackReleaseAdmissionCommand('sample', 'prod', 'next', false, { ...flags, ...extra });
  await stackReleaseAdmissionCommand('sample', 'prod', 'next', true, flags);
  await stackReleaseAdmissionCommand('sample', 'prod', 'next', false, { recoveryRun: flags.recoveryRun });
  for (const extra of [{}, { dryRun: true, infrastructure: 'preserve' as const }, { dryRun: true, allowDirty: true },
    { deploymentReview: 'a'.repeat(64), reinstall: true }, { dryRun: true, review: 'a'.repeat(64) }])
    await stackStartCommand('sample', 'prod', { release: 'next', ...flags, ...extra });
  expect(process.exitCode).toBe(1);
  expect(rpc.checkRelease).not.toHaveBeenCalled();
  expect(rpc.reviewStackStart).not.toHaveBeenCalled();
  expect(rpc.deployReviewedRelease).not.toHaveBeenCalled();
  expect(rpc.startStack).not.toHaveBeenCalled();
});

it('keeps an unconfirmed recovery request out of the ordinary start and preserve paths', async () => {
  const recovery = { recoveryRelease: 'compatible', recoveryRun: '31f297a8-93eb-455f-8267-19cdf415bd3f', recoveryProbe: 'a'.repeat(40) };
  rpc.checkRelease.mockResolvedValue({ ok: true, because: 'Old controller admitted an ordinary release' });
  await stackStartCommand('sample', 'prod', { release: 'next', dryRun: true, ...recovery });
  expect(process.exitCode).toBe(1);
  expect(output.emitError).toHaveBeenCalledWith(expect.stringContaining('did not confirm'), expect.anything());
  expect(rpc.reviewStackStart).not.toHaveBeenCalled();
  expect(rpc.startStack).not.toHaveBeenCalled();
});

it('prints the server-generated native qualification definition without starting the pipeline or the stack', async () => {
  const options = { recoveryRelease: 'compatible', recoveryProbe: 'a'.repeat(40), qaNode: 'isolated' };
  const definition = { name: 'recovery-trial', steps: [] };
  rpc.planRecoveryQualification.mockResolvedValueOnce(definition);
  await stackPlanRecoveryCommand('sample', 'prod', 'candidate', options);
  expect(rpc.planRecoveryQualification).toHaveBeenCalledExactlyOnceWith({ project: 'sample', stack: 'prod', release: 'candidate',
    recoveryRelease: 'compatible', probeCommit: options.recoveryProbe, qaNodeId: 'isolated' });
  expect(output.emitJson).toHaveBeenCalledWith(definition);
  expect(rpc.startStack).not.toHaveBeenCalled();
});
