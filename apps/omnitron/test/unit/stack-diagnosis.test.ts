import { describe, expect, it, vi } from 'vitest';
import { diagnoseContainers } from '../../src/project/stack-diagnosis.js';
import { diagnosisStatus } from '../../src/shared/dto/stack-diagnosis.js';
import { containerSpecHash, SPEC_HASH_LABEL } from '../../src/infrastructure/container-runtime.js';
import { mergeInferredInfrastructure } from '../../src/infrastructure/merge-config.js';
import type { ResolvedContainer } from '../../src/infrastructure/types.js';
import type { DockerInventory } from '../../src/infrastructure/container-runtime.js';
const container = (): ResolvedContainer => ({ name: 'sample-dev-postgres', image: 'postgres:17', ports: [{ host: 5540, container: 5432, bindHost: '127.0.0.1' }], environment: { PASSWORD: 'must-never-leak' }, volumes: [{ source: 'sample-data', target: '/data' }], labels: { 'omnitron.managed': 'true', 'omnitron.project': 'sample', 'omnitron.stack': 'dev', 'omnitron.service': 'postgres' }, restart: 'unless-stopped' });
const inventory = (): DockerInventory => ({ containers: [], images: [], volumes: [] });
const probes = (value = inventory()) => ({ inventory: vi.fn(async () => value), port: vi.fn(async () => true as boolean | null), mount: vi.fn(async () => 'present' as 'present' | 'missing' | 'unknown') });
describe('stack prerequisite evidence', () => {
  it('explains a first start without classifying provisionable absence as failure', async () => {
    const report = await diagnoseContainers([container()], probes());
    expect(diagnosisStatus(report)).toBe('changes');
    expect(report.map(check => check.code)).toEqual(['docker.available', 'container.create', 'image.pull', 'volume.create']);
    expect(JSON.stringify(report)).not.toContain('must-never-leak');
  });
  it('never interprets Docker refusal as absent services', async () => {
    const probe = probes(); probe.inventory.mockRejectedValue(new Error('denied secret detail'));
    const report = await diagnoseContainers([container()], probe);
    expect(diagnosisStatus(report)).toBe('unknown'); expect(JSON.stringify(report)).not.toContain('secret detail'); expect(probe.port).not.toHaveBeenCalled();
  });
  it('blocks foreign ownership and conflicting ports', async () => {
    const spec = container(); const data = inventory();
    data.containers.push({ name: spec.name, running: true, labels: {}, ports: [{ host: 5540 }] });
    const report = await diagnoseContainers([spec], probes(data));
    expect(report.filter(check => check.state === 'blocked').map(check => check.code)).toEqual(['container.foreign', 'port.conflict']);
  });
  it('accepts healthy owned services without rebinding their ports', async () => {
    const spec = container(); const data = inventory(); data.images.push(spec.image); data.volumes.push('sample-data');
    data.containers.push({ name: spec.name, running: true, health: 'healthy', labels: { ...spec.labels, [SPEC_HASH_LABEL]: containerSpecHash(spec) }, ports: [{ host: 5540 }] });
    const probe = probes(data); const report = await diagnoseContainers([spec], probe);
    expect(diagnosisStatus(report)).toBe('ready'); expect(probe.port).not.toHaveBeenCalled();
  });
  it('blocks missing bind mounts and retains unknown probe outcomes', async () => {
    const spec = container(); spec.volumes = [{ source: '/missing/config', target: '/config' }];
    const probe = probes(); probe.mount.mockResolvedValue('missing'); probe.port.mockResolvedValue(null);
    const report = await diagnoseContainers([spec], probe);
    expect(report).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'mount.unavailable', state: 'blocked' }), expect.objectContaining({ code: 'port.unavailable', state: 'unknown' })]));
  });
  it('detects duplicate planned ports before provisioning', async () => {
    const one = container(); const report = await diagnoseContainers([one, { ...one, name: 'other' }], probes());
    expect(report).toContainEqual(expect.objectContaining({ code: 'port.conflict', state: 'blocked' }));
  });
  it('retains inferred databases and buckets when only ports are overridden', () => {
    expect(mergeInferredInfrastructure({ postgres: { databases: { main: {} } }, minio: { buckets: ['media'] } }, { postgres: { port: 5433, databases: { audit: {} } }, minio: { buckets: ['backup'] } })).toMatchObject({ postgres: { port: 5433, databases: { main: {}, audit: {} } }, minio: { buckets: ['media', 'backup'] } });
  });
});
