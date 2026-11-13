import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { KubernetesService } from '../../src/services/kubernetes.service.js';

const native = vi.hoisted(() => {
  const forward = { localPort: 38123, open: vi.fn(), close: vi.fn() };
  const adapter = { executeKubectl: vi.fn(), portForward: vi.fn(), dispose: vi.fn() };
  return { forward, adapter, constructor: vi.fn(function KubernetesAdapter() { return adapter; }) };
});

vi.mock('@xec-sh/core', () => ({ KubernetesAdapter: native.constructor }));

const metadata = { name: 'worker-1', namespace: 'research', creationTimestamp: '2026-01-01T00:00:00Z' };
const pod = { metadata, spec: { nodeName: 'node-1' }, status: {
  phase: 'Running', containerStatuses: [{ ready: true, restartCount: 2 }, { ready: false, restartCount: 1 }],
} };
const options = { timeout: 30_000, throwOnNonZeroExit: true };

describe('KubernetesService through the Xec adapter', () => {
  let service: KubernetesService;

  beforeEach(() => {
    vi.clearAllMocks();
    native.adapter.executeKubectl.mockReset().mockResolvedValue({ stdout: '{"items":[]}', stderr: '', exitCode: 0 });
    native.adapter.portForward.mockReset().mockResolvedValue(native.forward);
    native.adapter.dispose.mockReset().mockResolvedValue(undefined);
    native.forward.open.mockReset().mockResolvedValue(undefined);
    native.forward.close.mockReset().mockResolvedValue(undefined);
    service = new KubernetesService({ logger: createNullLogger() } as ILoggerModule);
  });

  it('projects native pod observations and passes literal namespace and selector arguments', async () => {
    native.adapter.executeKubectl.mockResolvedValue({ stdout: JSON.stringify({ items: [pod] }), exitCode: 0 });
    const result = await service.listPods('research', 'app in (worker, collector)');
    expect(native.constructor).toHaveBeenCalledWith({ kubectlTimeout: 30_000 });
    expect(native.adapter.executeKubectl).toHaveBeenCalledWith([
      'get', 'pods', '--namespace', 'research', '--selector', 'app in (worker, collector)', '-o', 'json',
    ], options);
    expect(result).toEqual([expect.objectContaining({ name: 'worker-1', namespace: 'research', status: 'Running',
      ready: false, restarts: 3, node: 'node-1', labels: {} })]);
    await service.listPods();
    expect(native.adapter.executeKubectl).toHaveBeenLastCalledWith(['get', 'pods', '--all-namespaces', '-o', 'json'], options);
  });

  it('returns null only for the native not-found response and propagates authorization and transport failures', async () => {
    native.adapter.executeKubectl.mockResolvedValueOnce({ stdout: '', exitCode: 0 });
    await expect(service.getPod('missing')).resolves.toBeNull();
    expect(native.adapter.executeKubectl).toHaveBeenCalledWith([
      'get', 'pod', 'missing', '--namespace', 'default', '--ignore-not-found', '-o', 'json',
    ], options);
    for (const failure of [new Error('Forbidden'), new Error('connection refused')]) {
      native.adapter.executeKubectl.mockRejectedValue(failure);
      await expect(service.getPod('worker-1')).rejects.toBe(failure);
      await expect(service.listPods()).rejects.toBe(failure);
    }
    expect(native.adapter.executeKubectl).toHaveBeenCalledTimes(5);
  });

  it('preserves named service ports and rejects malformed list responses', async () => {
    native.adapter.executeKubectl.mockResolvedValueOnce({ stdout: JSON.stringify({ items: [{ metadata,
      spec: { ports: [{ port: 80, targetPort: 'http' }, { port: 443, targetPort: 8443 }] },
    }] }), exitCode: 0 });
    expect((await service.listServices())[0]?.ports).toEqual([
      { port: 80, targetPort: 'http', protocol: 'TCP' }, { port: 443, targetPort: 8443, protocol: 'TCP' },
    ]);
    native.adapter.executeKubectl.mockResolvedValueOnce({ stdout: '{"error":"unavailable"}', exitCode: 0 });
    await expect(service.listPods()).rejects.toThrow();
  });

  it('keeps a zero log tail and an explicit zero replica target', async () => {
    await service.getPodLogs('worker-1', 'research', { tail: 0 });
    expect(native.adapter.executeKubectl).toHaveBeenLastCalledWith([
      'logs', 'worker-1', '--namespace', 'research', '--tail', '0',
    ], options);
    await service.scaleDeployment('workers', 0, 'research');
    expect(native.adapter.executeKubectl).toHaveBeenLastCalledWith([
      'scale', 'deployment', 'workers', '--replicas=0', '--namespace', 'research',
    ], options);
  });

  it('executes literal command arguments after the native option boundary', async () => {
    const command = ['printf', '%s', '$(touch /tmp/not-executed)', 'a b'];
    await service.exec('worker-1', command, 'research');
    expect(native.adapter.executeKubectl).toHaveBeenCalledWith([
      'exec', 'worker-1', '--namespace', 'research', '--', ...command,
    ], options);
  });

  it('refuses option-like identifiers and malformed operations before the adapter is called', async () => {
    await expect(service.deletePod('--all')).rejects.toThrow('Invalid Kubernetes pod');
    await expect(service.listPods('--all')).rejects.toThrow('Invalid Kubernetes namespace');
    await expect(service.scaleDeployment('worker', -1)).rejects.toThrow('Replicas');
    await expect(service.getPodLogs('worker', 'default', { tail: 1.5 })).rejects.toThrow('Log tail');
    await expect(service.exec('worker', [])).rejects.toThrow('pod command');
    await expect(service.portForward('worker', 65536, 80)).rejects.toThrow('forwarding ports');
    expect(native.adapter.executeKubectl).not.toHaveBeenCalled();
    expect(native.adapter.portForward).not.toHaveBeenCalled();
  });

  it('opens the Xec forwarding session, exposes its allocated port and awaits shutdown', async () => {
    const forward = await service.portForward('worker', 0, 80, 'research');
    expect(native.adapter.portForward).toHaveBeenCalledWith('worker', 0, 80, { namespace: 'research', dynamicLocalPort: true });
    expect(native.forward.open).toHaveBeenCalledOnce();
    expect(forward.localPort).toBe(38123);
    const closing = Promise.withResolvers<void>();
    native.forward.close.mockReturnValue(closing.promise);
    const closed = vi.fn();
    const result = forward.close().then(closed);
    await Promise.resolve();
    expect(closed).not.toHaveBeenCalled();
    closing.resolve();
    await result;
    expect(closed).toHaveBeenCalledOnce();
    await service.dispose();
    expect(native.adapter.dispose).toHaveBeenCalledOnce();
  });
});
