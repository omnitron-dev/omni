import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  rpc: {} as Record<string, (arg?: unknown) => unknown>,
  printed: [] as Array<{ level: string; text: string }>,
  calls: [] as string[],
}));
vi.mock('@xec-sh/kit', () => ({ log: Object.fromEntries(['info', 'success', 'warn', 'error'].map(level =>
  [level, (text: string) => fixture.printed.push({ level, text })])) }));
vi.mock('../../src/daemon/daemon-client.js', () => ({ createDaemonClient: () => ({
  isReachable: async () => true,
  disconnect: async () => undefined,
  service: async () => new Proxy({}, { get: (_, name: string) => {
    if (name === 'then') return undefined;
    return (arg?: unknown) => {
      fixture.calls.push(name);
      if (!fixture.rpc[name]) throw new Error(`Unknown member: '${name}' is not defined in the service interface`);
      return fixture.rpc[name](arg);
    };
  } }),
}) }));

const commands = await import('../../src/commands/backup.js');
const { resetEnvCache } = await import('../../src/shared/env-config.js');
const previousMode = process.env['OMNITRON_OUTPUT'];
const previousExitCode = process.exitCode;
const backup = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', database: 'main', filename: 'main.sql.gz',
  size: 100, createdAt: '2026-01-01T00:00:00Z', compressed: true };

beforeEach(() => {
  delete process.env['OMNITRON_OUTPUT'];
  resetEnvCache();
  process.exitCode = undefined;
  fixture.rpc = {};
  fixture.printed.length = 0;
  fixture.calls.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
  if (previousMode === undefined) delete process.env['OMNITRON_OUTPUT'];
  else process.env['OMNITRON_OUTPUT'] = previousMode;
  resetEnvCache();
});

describe('backup command outcomes', () => {
  const operation = { protocol: 1, id: backup.id, kind: 'backup', revision: 5, state: 'unknown',
    inputDigest: 'a'.repeat(64), resources: [{ kind: 'database', project: 'example', stack: 'dev', name: 'main' }],
    createdAt: backup.createdAt, updatedAt: backup.createdAt,
    execution: { type: 'docker-container', operationId: backup.id, daemonId: 'example-daemon' },
    code: 'BACKUP_EXECUTION_UNCONFIRMED' };

  it.each([undefined, backup.id])('reads the exact operation receipt without replay (id=%s)', async id => {
    process.env['OMNITRON_OUTPUT'] = 'json'; resetEnvCache();
    fixture.rpc['listOperations'] = () => [operation];
    fixture.rpc['getOperation'] = vi.fn(() => operation);
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
    await commands.backupOperationsCommand(id);
    expect(JSON.parse(output)).toEqual({ ok: true, data: id ? operation : [operation] });
    expect(fixture.calls).toEqual([id ? 'getOperation' : 'listOperations']);
    if (id) expect(fixture.rpc['getOperation']).toHaveBeenCalledWith({ id });
    expect(process.exitCode).toBeUndefined();
  });

  it.each(['cancel', 'reconcile'] as const)('preserves an unknown %s outcome and the inspected revision in JSON', async action => {
    process.env['OMNITRON_OUTPUT'] = 'json'; resetEnvCache();
    const method = `${action}Operation`;
    fixture.rpc[method] = vi.fn(() => operation);
    let output = '', error = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { error += String(chunk); return true; });
    await commands.backupOperationActionCommand(action, operation.id, { revision: '5' });
    expect(fixture.rpc[method]).toHaveBeenCalledWith({ id: operation.id, revision: 5 });
    expect(fixture.calls).toEqual([method]);
    expect(output).toBe('');
    expect(JSON.parse(error)).toMatchObject({ ok: false, code: 'BACKUP_OUTCOME_UNCONFIRMED', outcome: 'unknown', operation });
    expect(process.exitCode).toBe(1);
    expect(fixture.printed).toEqual([]);
  });

  it('retains the actual failed backup outcome after successful reconciliation', async () => {
    fixture.rpc['reconcileOperation'] = () => ({ ...operation, state: 'failed', revision: 6, code: 'BACKUP_INTERRUPTED' });
    await commands.backupOperationActionCommand('reconcile', operation.id, { revision: '5' });
    expect(process.exitCode).toBeUndefined();
    expect(fixture.printed.some(line => line.text.includes('failed · revision 6'))).toBe(true);
    expect(fixture.printed.some(line => line.level === 'success')).toBe(false);
  });

  it('does not replace a stale cancellation revision or retry after refusal', async () => {
    fixture.rpc['cancelOperation'] = () => { throw Object.assign(new Error('Operation changed'), { code: 'OPERATION_REVISION_CONFLICT' }); };
    await commands.backupOperationActionCommand('cancel', operation.id, { revision: '4' });
    expect(fixture.calls).toEqual(['cancelOperation']);
    expect(process.exitCode).toBe(1);
  });

  it.each(['0', '-1', '1.5', '1e3', '9007199254740992', ''])('refuses invalid recovery revision %j before connecting', async revision => {
    await commands.backupOperationActionCommand('cancel', operation.id, { revision });
    expect(fixture.calls).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('does not accept an operation prefix as cancellation authority', async () => {
    await commands.backupOperationActionCommand('cancel', operation.id.slice(0, 8), { revision: '5' });
    expect(fixture.calls).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it('reports a missing historical operation without manufacturing a receipt', async () => {
    fixture.rpc['getOperation'] = () => null;
    await commands.backupOperationsCommand(operation.id);
    expect(process.exitCode).toBe(1);
    expect(fixture.printed.some(line => line.text === 'Backup operation not found')).toBe(true);
  });

  it('shows the effective transfer deadline even without a schedule', async () => {
    fixture.rpc['getBackupStatus'] = () => ({ databaseTimeoutMs: 1_800_000, schedules: [], stacks: [] });
    await commands.backupSchedulesCommand();
    expect(fixture.printed.some(line => line.text === 'Database transfer deadline: 30 min')).toBe(true);
  });

  it('returns the complete diagnostic status as machine-readable JSON', async () => {
    process.env['OMNITRON_OUTPUT'] = 'json';
    resetEnvCache();
    const status = { databaseTimeoutMs: 1_800_000, schedules: [], stacks: [] };
    fixture.rpc['getBackupStatus'] = () => status;
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { output += String(chunk); return true; });
    await commands.backupSchedulesCommand();
    expect(JSON.parse(output)).toEqual({ ok: true, data: status });
    expect(fixture.printed).toEqual([]);
  });

  it.each([
    ['createBackup', () => commands.backupCreateCommand('main')],
    ['createAllBackups', () => commands.backupCreateCommand()],
    ['createFullBackup', () => commands.backupFullCommand()],
    ['listBackups', () => commands.backupListCommand()],
    ['setSchedule', () => commands.backupScheduleCommand('all', 'hourly')],
    ['getBackupStatus', () => commands.backupSchedulesCommand()],
    ['removeSchedule', () => commands.backupUnscheduleCommand('all')],
    ['restoreBackup', () => commands.backupRestoreCommand(backup.id)],
  ] as const)('returns failure when %s is refused', async (method, command) => {
    fixture.rpc['listBackups'] = () => [backup];
    fixture.rpc[method] = () => { throw new Error('permission denied'); };
    await command();
    expect(process.exitCode).toBe(1);
    expect(fixture.printed.some(line => line.level === 'error' && line.text.includes('permission denied'))).toBe(true);
    expect(fixture.printed.some(line => line.level === 'success')).toBe(false);
  });

  it('does not replace missing status with the obsolete schedule-only response', async () => {
    fixture.rpc['listSchedules'] = () => ({ all: 'hourly' });
    await commands.backupSchedulesCommand();
    expect(process.exitCode).toBe(1);
    expect(fixture.calls).toEqual(['getBackupStatus']);
    expect(fixture.printed.some(line => line.text.includes('getBackupStatus'))).toBe(true);
  });

  it('retains useful index rows but fails when coverage could not be read', async () => {
    fixture.rpc['listBackups'] = () => [backup];
    fixture.rpc['getBackupStatus'] = () => { throw new Error('connection lost'); };
    await commands.backupListCommand();
    expect(process.exitCode).toBe(1);
    expect(fixture.printed.some(line => line.text.includes(backup.filename))).toBe(true);
    expect(fixture.printed.some(line => line.level === 'warn' && line.text.includes('connection lost'))).toBe(true);
  });

  it.each(['list', 'schedules'])('shows uncovered stacks even when %s is empty', async command => {
    fixture.rpc['listBackups'] = () => [];
    fixture.rpc['getBackupStatus'] = () => ({ schedules: [], stacks: [
      { project: 'sample', stack: 'test', databases: [], notBackedUp: 'infrastructure is on another node' },
    ] });
    await (command === 'list' ? commands.backupListCommand() : commands.backupSchedulesCommand());
    expect(process.exitCode).toBeUndefined();
    expect(fixture.printed.some(line => line.level === 'warn' && line.text.includes('sample/test'))).toBe(true);
  });

  it.each(['createAllBackups', 'createFullBackup'] as const)('reports partial %s failure while preserving each target result', async method => {
    fixture.rpc[method] = () => [
      { database: 'main', target: 'main', ok: true, id: backup.id, size: 100 },
      { database: 'payments', target: 'payments', ok: false, error: 'disk full' },
    ];
    await (method === 'createAllBackups' ? commands.backupCreateCommand() : commands.backupFullCommand());
    expect(process.exitCode).toBe(1);
    expect(fixture.printed.some(line => line.level === 'success' && line.text.includes('main'))).toBe(true);
    expect(fixture.printed.some(line => line.level === 'error' && line.text.includes('disk full'))).toBe(true);
  });

  it.each(['createAllBackups', 'createFullBackup'] as const)('does not claim %s succeeded when there were no targets', async method => {
    fixture.rpc[method] = () => [];
    await (method === 'createAllBackups' ? commands.backupCreateCommand() : commands.backupFullCommand());
    expect(process.exitCode).toBe(1);
  });

  it.each(['setSchedule', 'removeSchedule', 'restoreBackup'] as const)('requires a positive %s acknowledgement', async method => {
    fixture.rpc['listBackups'] = () => [backup];
    fixture.rpc[method] = () => ({ success: false });
    if (method === 'setSchedule') await commands.backupScheduleCommand('all', 'hourly');
    else if (method === 'removeSchedule') await commands.backupUnscheduleCommand('all');
    else await commands.backupRestoreCommand(backup.id);
    expect(process.exitCode).toBe(1);
    expect(fixture.printed.some(line => line.level === 'success')).toBe(false);
  });

  it('keeps successful local capture successful and names uncovered remote stacks', async () => {
    fixture.rpc['createAllBackups'] = () => [
      { database: 'main', project: 'sample', stack: 'dev', ok: true, id: backup.id, size: 100 },
      { database: 'sample/test', ok: false, skipped: true, error: 'infrastructure is on another node' },
    ];
    await commands.backupCreateCommand();
    expect(process.exitCode).toBeUndefined();
    expect(fixture.printed.some(line => line.text.includes('Done: 1/1'))).toBe(true);
    expect(fixture.printed.some(line => line.level === 'warn' && line.text.includes('sample/test'))).toBe(true);
  });
});
