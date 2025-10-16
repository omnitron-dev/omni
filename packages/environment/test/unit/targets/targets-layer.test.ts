import { describe, it, expect } from 'vitest';
import { TargetsLayer } from '../../../src/targets/targets-layer.js';

describe('TargetsLayer', () => {
  it('should define and get targets', () => {
    const layer = new TargetsLayer();

    layer.define('local', {
      type: 'local',
    });

    const target = layer.get('local');
    expect(target).toBeDefined();
    expect(target?.type).toBe('local');
  });

  it('should check if target exists', () => {
    const layer = new TargetsLayer();

    layer.define('existing', { type: 'local' });

    expect(layer.has('existing')).toBe(true);
    expect(layer.has('nonexistent')).toBe(false);
  });

  it('should delete targets', () => {
    const layer = new TargetsLayer();

    layer.define('temp', { type: 'local' });
    expect(layer.has('temp')).toBe(true);

    layer.delete('temp');
    expect(layer.has('temp')).toBe(false);
  });

  it('should resolve target reference', async () => {
    const layer = new TargetsLayer();

    layer.define('production', {
      type: 'ssh',
      host: 'prod.example.com',
      port: 22,
    });

    const target = await layer.resolve('production');

    expect(target.name).toBe('production');
    expect(target.type).toBe('ssh');
    expect(target.config.host).toBe('prod.example.com');
  });

  it('should list all targets', async () => {
    const layer = new TargetsLayer();

    layer.define('local', { type: 'local' });
    layer.define('remote', { type: 'ssh', host: 'remote.com' });

    const list = await layer.list();

    expect(list).toHaveLength(2);
    expect(list.some((t) => t.name === 'local')).toBe(true);
    expect(list.some((t) => t.name === 'remote')).toBe(true);
  });

  it('should find targets by pattern', async () => {
    const layer = new TargetsLayer();

    layer.define('prod-web-1', { type: 'ssh', host: 'web1.prod.com' });
    layer.define('prod-web-2', { type: 'ssh', host: 'web2.prod.com' });
    layer.define('staging-web-1', { type: 'ssh', host: 'web1.staging.com' });

    const prodTargets = await layer.find('prod-.*');

    expect(prodTargets).toHaveLength(2);
    expect(prodTargets.every((t) => t.name.startsWith('prod-'))).toBe(true);
  });

  it('should execute command on local target', async () => {
    const layer = new TargetsLayer();

    layer.define('local', { type: 'local' });

    const result = await layer.execute('local', 'echo "test"');

    expect(result.success).toBe(true);
    expect(result.stdout).toContain('test');
  });

  it('should auto-detect local target', async () => {
    const layer = new TargetsLayer();

    const target = await layer.autoDetect('localhost');

    expect(target).toBeDefined();
    expect(target?.type).toBe('local');
  });
});
