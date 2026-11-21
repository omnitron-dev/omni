import { beforeEach, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ execute: vi.fn(), inspect: vi.fn() }));
vi.mock('@xec-sh/core', () => ({ ExecutionEngine: class {
  execute = native.execute;
  async dispose() {}
} }));
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(), execFile: native.inspect,
}));
import { inspectStackContainers, listManagedContainers } from '../../src/infrastructure/container-runtime.js';

const scope = { project: 'example', stack: 'dev' };
const database = { ...scope, id: 'a'.repeat(64), name: 'example-dev-db', managed: 'true' };
const unrelated = { id: 'b'.repeat(64), name: 'unrelated', managed: '', project: '', stack: '' };
const otherStack = { ...database, id: 'c'.repeat(64), name: 'example-test-db', stack: 'test' };

beforeEach(() => {
  vi.resetAllMocks();
  native.execute.mockResolvedValue({ stdout: [unrelated, otherStack, database].map(row => JSON.stringify(row)).join('\n') });
});

it('reviews a stack from the ownership listing even when an unrelated native inspection would hang', async () => {
  await expect(inspectStackContainers(scope)).resolves.toEqual([{ id: database.id, name: database.name }]);
  expect(native.execute).toHaveBeenCalledOnce();
  expect(native.execute.mock.calls[0]![0].args).toEqual(expect.arrayContaining(['-a', '--no-trunc', 'label=omnitron.project=example', 'label=omnitron.stack=dev']));
  expect(native.inspect).not.toHaveBeenCalled();
});

it('checks declared names against foreign and unmanaged owners before planning any container operation', async () => {
  await expect(inspectStackContainers(scope, [unrelated.name])).rejects.toThrow('unmanaged');
  await expect(inspectStackContainers(scope, [otherStack.name])).rejects.toThrow('another allocation');
  expect(native.execute.mock.calls[0]![0].args).not.toContain('--filter');
  expect(native.inspect).not.toHaveBeenCalled();
});

it('inspects only managed IDs and refuses a partial observation in strict mode', async () => {
  native.inspect.mockImplementation((_bin, args: string[], _options, done) => {
    expect(args).toEqual(['inspect', otherStack.id, database.id]);
    done(null, { stdout: JSON.stringify([{ Id: database.id, Name: '/' + database.name, Config: { Labels: { 'omnitron.managed': 'true' } } }]) });
  });
  await expect(listManagedContainers({ orThrow: true })).rejects.toThrow('inventory changed');
  expect(native.inspect).toHaveBeenCalledOnce();
});

it('reports an unavailable native inventory separately from an empty one', async () => {
  native.execute.mockRejectedValueOnce(Error('engine unavailable')).mockResolvedValueOnce({ stdout: '' });
  await expect(inspectStackContainers(scope)).rejects.toThrow('engine unavailable');
  await expect(inspectStackContainers(scope)).resolves.toEqual([]);
  expect(native.inspect).not.toHaveBeenCalled();
});
