import { describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diskSpaceFlow, evaluateFlow } from '../../src/shared/dto/flows.js';
import { loadHostFlowRegistry, registryFromFlowPack } from '../../src/flows/component-packs.js';

const extension = {
  type: 'capacity.threshold@1',
  label: 'Volume threshold',
  fields: [
    { key: 'floor', label: 'Enter below', type: 'number', min: 0 },
    { key: 'recover', label: 'Recover at', type: 'number', min: 0 },
  ],
  steps: [
    { type: 'data.select@1', config: { fields: ['freeBytes'] } },
    { type: 'logic.threshold@1', config: { field: 'freeBytes' }, bind: { below: 'floor', rearmAt: 'recover' } },
  ],
};
const pack = { version: 1, components: [extension] };
describe('Host flow component library', () => {
  it('runs the same parameterized component for preview and subsequent samples, with a pinned semantic identity', () => {
    const graph = diskSpaceFlow('/sample', 10, 20);
    graph.nodes[1] = { id: 'threshold', type: extension.type, config: { floor: 10, recover: 20 } };
    const registry = registryFromFlowPack(pack);
    expect(registry.catalog().find((n) => n.type === extension.type)).toMatchObject({
      label: 'Volume threshold',
      ports: ['low', 'recovered'],
    });
    const event = { id: '1', source: 'disk', type: 'host.disk.sample', data: { freeBytes: 8, totalBytes: 30 } };
    const low = evaluateFlow(graph, event, {}, registry);
    expect(low.effects[0]?.data).toEqual({ freeBytes: 8 });
    const recovered = evaluateFlow(
      graph,
      { ...event, id: '2', data: { freeBytes: 20, totalBytes: 30 } },
      low.state,
      registry
    );
    expect(recovered.traversed.at(-1)?.port).toBe('recovered');
    const second = registryFromFlowPack({ version: 1, components: [{ ...extension, label: 'Capacity' }] });
    expect(registry.dependencies(graph)[extension.type]).toMatch(/^[0-9a-f]{64}$/);
    expect(second.dependencies(graph)[extension.type]).not.toEqual(registry.dependencies(graph)[extension.type]);
    expect(() =>
      registryFromFlowPack({
        version: 1,
        components: [{ ...extension, steps: [{ type: 'output.run-pipeline@1', config: {} }] }],
      })
    ).toThrow('compose transformations');
  });
  it('contains an invalid pack and preserves core components and a visible diagnostic', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flow-library-'));
    try {
      const file = join(dir, 'flow-components.json');
      expect(loadHostFlowRegistry(dir).diagnostics).toEqual([]);
      writeFileSync(file, JSON.stringify(pack), { mode: 0o600 });
      expect(loadHostFlowRegistry(dir).get(extension.type).ports).toEqual(['low', 'recovered']);
      writeFileSync(file, '{private manifest fragment');
      expect(loadHostFlowRegistry(dir).diagnostics.join(' ')).not.toContain('private manifest fragment');
      expect(loadHostFlowRegistry(dir).diagnostics.join(' ')).toContain('Invalid JSON');
      expect(loadHostFlowRegistry(dir).get('host.disk@1').label).toBe('Disk free space');
      if (process.platform !== 'win32') {
        writeFileSync(file, JSON.stringify(pack));
        chmodSync(file, 0o666);
        expect(loadHostFlowRegistry(dir).diagnostics[0]).toContain('operator-owned');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
