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
  process.exitCode = previousExitCode;
  if (previousMode === undefined) delete process.env['OMNITRON_OUTPUT'];
  else process.env['OMNITRON_OUTPUT'] = previousMode;
  resetEnvCache();
});

describe('backup command outcomes', () => {
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
