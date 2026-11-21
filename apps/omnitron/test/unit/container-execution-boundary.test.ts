import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';

const native = vi.hoisted(() => ({
  create: vi.fn(), start: vi.fn(), inspect: vi.fn(), remove: vi.fn(), engines: vi.fn(), dispose: vi.fn(),
  network: vi.fn(), sweep: vi.fn(),
}));
vi.mock('node:child_process', async original => ({ ...await original<object>(), execFile: native.network }));
vi.mock('../../src/infrastructure/phantom-endpoint-janitor.js', () => ({
  PhantomEndpointJanitor: class { sweepNetwork = native.sweep; },
}));
vi.mock('@xec-sh/core', () => ({
  DockerAdapter: class {
    async listImages() { return ['example/service:1']; }
    removeContainer = native.remove;
  },
  ExecutionEngine: class {
    constructor(options: unknown) { native.engines(options); }
    async execute(command: { args: string[] }) {
      const [scope, operation] = command.args;
      if (scope !== 'container') throw Error('Unexpected Docker command: ' + scope);
      if (operation === 'create') return native.create(command);
      if (operation === 'start') return native.start(command.args.at(-1));
      if (operation === 'inspect') return { stdout: JSON.stringify([await native.inspect(command.args.at(-1))]) };
      throw Error('Unexpected Docker operation: ' + operation);
    }
    dispose = native.dispose;
  },
}));
import { createContainer } from '../../src/infrastructure/container-runtime.js';

const id = 'abcdef1234567890'.repeat(4);
const config = (): ResolvedContainer => ({
  name: 'sample-service', image: 'example/service:1', ports: [], volumes: [], labels: {}, restart: 'no', critical: false,
  environment: { RPC_PASSWORD: 'environment-secret' }, command: ['--rpc-login', 'service:rpc-secret'],
  healthCheck: { test: ['CMD-SHELL', 'curl --user "service:health secret" http://localhost/health'] },
});
const published = () => ({ ...config(), ports: [{ host: 19800, container: 80, bindHost: '127.0.0.1' }] });
function observation(status = 'running') {
  const args = native.create.mock.calls[0]![0].args as string[];
  const labels = Object.fromEntries(args.flatMap((value, index) => value === '--label' ? [args[index + 1]!.split('=')] : []));
  const ports = { '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '19800' }] };
  return { Id: id, Name: '/sample-service', Config: { Image: 'example/service:1', Labels: labels },
    State: { Status: status }, HostConfig: { PortBindings: structuredClone(ports) }, NetworkSettings: { Ports: ports } };
}
const commandFailure = (stderr: string) => Object.assign(Error(stderr), { code: 'COMMAND_FAILED', stderr });
const lostReply = () => Object.assign(Error('Docker acknowledgement lost'), { code: 'TIMEOUT_ERROR' });
beforeEach(() => {
  vi.resetAllMocks();
  native.create.mockResolvedValue({ stdout: id + '\n' });
  native.start.mockResolvedValue({ stdout: id });
  native.inspect.mockImplementation(async () => observation());
});
afterEach(() => { vi.useRealTimers(); });

describe('immutable Docker allocation and startup', () => {
  it('executes bounded, redacted Xec argv and starts only the acknowledged full ID', async () => {
    await expect(createContainer(config())).resolves.toBe(id.slice(0, 12));
    expect(native.engines).toHaveBeenCalledWith(expect.objectContaining({ defaultShell: false, enableEvents: false }));
    expect(native.create).toHaveBeenCalledWith(expect.objectContaining({ command: 'docker', adapter: 'local', shell: false,
      maxBuffer: 1024 * 1024, args: expect.arrayContaining(['create', '--rpc-login', 'service:rpc-secret',
        '--health-cmd', 'curl --user "service:health secret" http://localhost/health']) }));
    expect(native.create.mock.calls[0]![0].timeout).toBeGreaterThan(240_000);
    expect(native.create.mock.calls[0]![0].timeout).toBeLessThanOrEqual(300_000);
    expect(native.start.mock.calls).toEqual([[id]]);
    expect(native.dispose).toHaveBeenCalledTimes(2);
  });

  it('waits across an absent name for a late native create and starts its exact allocation once', async () => {
    vi.useFakeTimers();
    native.create.mockRejectedValueOnce(lostReply());
    native.inspect.mockRejectedValueOnce(commandFailure('Error response from daemon: No such container: sample-service'))
      .mockImplementationOnce(async () => observation('created')).mockImplementation(async () => observation());
    const result = createContainer(published(), { fullId: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(id);
    expect(native.inspect.mock.calls).toEqual([['sample-service'], ['sample-service'], [id]]);
    expect(native.start.mock.calls).toEqual([[id]]);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('joins a lost start reply through the exact ID even while Docker still reports Created', async () => {
    vi.useFakeTimers();
    native.start.mockRejectedValueOnce(lostReply());
    native.inspect.mockImplementationOnce(async () => observation('created'));
    const result = createContainer(published(), { fullId: true });
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(id);
    expect(native.inspect.mock.calls).toEqual([[id], [id]]);
    expect(native.start.mock.calls).toEqual([[id]]);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it.each(['acknowledged', 'lost'])('keeps the same allocation across three minutes of create lag and delayed publication with a %s start reply', async reply => {
    vi.useFakeTimers();
    native.create.mockRejectedValueOnce(lostReply());
    if (reply === 'lost') native.start.mockRejectedValueOnce(lostReply());
    let visible = false;
    let publishedPorts = false;
    native.inspect.mockImplementation(async ref => {
      if (!visible) throw commandFailure('No such container: sample-service');
      if (ref === 'sample-service') return observation('created');
      expect(ref).toBe(id);
      const state = observation();
      if (!publishedPorts) return { ...state, NetworkSettings: { Ports: {} } };
      return state;
    });
    const result = createContainer(published(), { fullId: true });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(native.start).not.toHaveBeenCalled();
    visible = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.start.mock.calls).toEqual([[id]]);
    expect(native.remove).not.toHaveBeenCalled();
    publishedPorts = true;
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(id);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('accepts a proved running allocation without repeating its start', async () => {
    native.create.mockRejectedValueOnce(lostReply());
    await expect(createContainer(published(), { fullId: true })).resolves.toBe(id);
    expect(native.inspect.mock.calls).toEqual([['sample-service']]);
    expect(native.start).not.toHaveBeenCalled();
  });

  it('refuses a late allocation with unconfirmed native resource limits before starting it', async () => {
    native.create.mockRejectedValueOnce(lostReply());
    native.inspect.mockImplementationOnce(async () => observation('created'));
    await expect(createContainer({ ...published(), resources: { memory: '32m' } })).rejects.toThrow('resource limits');
    expect(native.start).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('retains a running allocation with wrong native bindings after losing its start acknowledgement', async () => {
    vi.useFakeTimers();
    native.start.mockRejectedValueOnce(lostReply());
    native.inspect.mockImplementation(async () => {
      const state = observation(); state.NetworkSettings.Ports['80/tcp'][0]!.HostIp = '0.0.0.0'; return state;
    });
    const failure = expect(createContainer(published())).rejects.toMatchObject({
      message: expect.stringContaining('Docker start is unconfirmed'), cause: { message: expect.stringContaining('declared ports') },
    });
    await vi.advanceTimersByTimeAsync(600_001);
    await failure;
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.start.mock.calls).toEqual([[id]]);
    expect(native.remove).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'wrong-spec', 'wrong-image', 'wrong-binding', 'bad-id', 'exited'] as const)('refuses a competing or unverifiable create receipt (%s)', async proof => {
    native.create.mockRejectedValueOnce(lostReply());
    native.inspect.mockImplementation(async () => {
      const actual = observation(proof === 'exited' ? 'exited' : 'created');
      if (proof === 'foreign') actual.Config.Labels['omnitron.creation'] = 'competing-attempt';
      if (proof === 'wrong-spec') actual.Config.Labels['omnitron.spec-hash'] = 'other';
      if (proof === 'wrong-image') actual.Config.Image = 'other:1';
      if (proof === 'wrong-binding') actual.HostConfig.PortBindings['80/tcp'][0]!.HostIp = '0.0.0.0';
      if (proof === 'bad-id') actual.Id = id.slice(0, 12);
      return actual;
    });
    await expect(createContainer(published())).rejects.toThrow();
    expect(native.start).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
    expect(native.create).toHaveBeenCalledOnce();
  });

  it('leaves another instance at the same name alone when create is refused', async () => {
    native.create.mockRejectedValueOnce(commandFailure('The container name "/sample-service" is already in use by container "other"'));
    native.inspect.mockImplementation(async () => {
      const actual = observation(); actual.Config.Labels['omnitron.creation'] = 'other'; return actual;
    });
    await expect(createContainer(config())).rejects.toThrow('belongs to another creation');
    expect(native.start).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('cannot issue a late start or a second create after its observation deadline', async () => {
    vi.useFakeTimers();
    native.create.mockRejectedValueOnce(lostReply());
    let visible = false;
    native.inspect.mockImplementation(async () => {
      if (visible) return observation('created');
      throw commandFailure('No such container: sample-service');
    });
    const failure = expect(createContainer(config())).rejects.toThrow(/Docker create is unconfirmed.*creation/);
    await vi.advanceTimersByTimeAsync(600_001);
    await failure;
    visible = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(native.start).not.toHaveBeenCalled();
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('refuses an ID replaced during startup without touching the replacement', async () => {
    native.start.mockRejectedValueOnce(lostReply());
    native.inspect.mockImplementation(async () => ({ ...observation(), Id: 'd'.repeat(64) }));
    await expect(createContainer(published())).rejects.toThrow('immutable container ID');
    expect(native.inspect.mock.calls).toEqual([[id]]);
    expect(native.start.mock.calls).toEqual([[id]]);
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('never follows a name reused between recovering an allocation and starting it', async () => {
    native.create.mockRejectedValueOnce(lostReply());
    native.inspect.mockImplementationOnce(async () => observation('created'));
    native.start.mockRejectedValueOnce(commandFailure('Error response from daemon: No such container: ' + id));
    await expect(createContainer(published())).rejects.toThrow('No such container: ' + id);
    expect(native.inspect.mock.calls).toEqual([['sample-service']]);
    expect(native.start.mock.calls).toEqual([[id]]);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('recreates an exact stopped allocation after Docker explicitly refuses the port bind', async () => {
    vi.useFakeTimers();
    const replacement = 'e'.repeat(64);
    native.create.mockResolvedValueOnce({ stdout: id }).mockResolvedValueOnce({ stdout: replacement });
    native.start.mockRejectedValueOnce(commandFailure('port is already allocated')).mockResolvedValueOnce({ stdout: replacement });
    native.inspect.mockImplementationOnce(async () => observation('created'))
      .mockImplementationOnce(async () => ({ ...observation(), Id: replacement }));
    const result = createContainer(published(), { fullId: true });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(replacement);
    expect(native.start.mock.calls).toEqual([[id], [replacement]]);
    expect(native.remove.mock.calls).toEqual([[id, true, {}]]);
  });

  it('validates both TCP ports and every published address on the exact running ID', async () => {
    native.inspect.mockImplementation(async () => {
      const actual = observation();
      actual.NetworkSettings.Ports['80/tcp'].push({ HostIp: '0.0.0.0', HostPort: '19800' });
      return actual;
    });
    await expect(createContainer(published())).rejects.toThrow('did not publish the declared ports');
    expect(native.start.mock.calls).toEqual([[id], [id]]);
    expect(native.inspect.mock.calls).toEqual([[id], [id]]);
    expect(native.remove.mock.calls).toEqual([[id, true, {}], [id, true, {}]]);
  });

  it('rebuilds once when the managed network confirms a same-name phantom and the owned ID still has no published ports', async () => {
    native.network.mockImplementation((file, args, _options, done) => {
      expect([file, ...args]).toEqual(['docker', 'network', 'inspect', 'fixture-net']);
      done(null, '');
    });
    native.sweep.mockResolvedValue(1);
    const replacement = 'e'.repeat(64);
    native.create.mockResolvedValueOnce({ stdout: id }).mockResolvedValueOnce({ stdout: replacement });
    native.start.mockResolvedValueOnce({ stdout: id }).mockResolvedValueOnce({ stdout: replacement });
    native.inspect.mockImplementation(async ref => ref === id
      ? { ...observation(), NetworkSettings: { Ports: {} } }
      : { ...observation(), Id: replacement });
    await expect(createContainer({ ...published(), network: 'fixture-net' }, { fullId: true })).resolves.toBe(replacement);
    expect(native.sweep.mock.calls).toEqual([['fixture-net', 'sample-service']]);
    expect(native.inspect.mock.calls).toEqual([[id], [id], [replacement]]);
    expect(native.remove.mock.calls).toEqual([[id, true, {}]]);
    expect(native.start.mock.calls).toEqual([[id], [replacement]]);
  });

  it('preserves the sanitized error from a definitive Docker refusal', async () => {
    const failure = commandFailure('docker create --rpc-login [REDACTED]: image unavailable');
    native.create.mockRejectedValueOnce(failure);
    await expect(createContainer(config())).rejects.toBe(failure);
    expect(native.start).not.toHaveBeenCalled();
    expect(native.dispose).toHaveBeenCalledOnce();
  });
});
