/**
 * Tests for MeshNode
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMeshNode } from '../../src/mesh/node.js';
import { flow } from '@holon/flow';

describe('MeshNode', () => {
  let node: Awaited<ReturnType<typeof createMeshNode>>;

  beforeEach(async () => {
    node = await createMeshNode({
      name: 'test-node',
      port: 3000,
      discovery: { type: 'static' },
    });
  });

  afterEach(async () => {
    await node.stop();
  });

  it('should register a service', async () => {
    const addFlow = flow((x: number) => x + 1);
    await node.register('add', addFlow);

    const service = node.getService('add');
    expect(service).toBeDefined();
    expect(service?.name).toBe('add');
  });

  it('should unregister a service', async () => {
    const addFlow = flow((x: number) => x + 1);
    await node.register('add', addFlow);
    await node.unregister('add');

    const service = node.getService('add');
    expect(service).toBeUndefined();
  });

  it('should execute registered service', async () => {
    const addFlow = flow((x: number) => x + 1);
    await node.register('add', addFlow);

    const result = await node.execute('add', 5);
    expect(result).toBe(6);
  });

  it('should throw error for non-existent service', async () => {
    await expect(node.execute('nonexistent', 5)).rejects.toThrow('Service not found');
  });

  it('should check health', async () => {
    const health = await node.checkHealth();

    expect(health.healthy).toBe(true);
    expect(health.checks.length).toBeGreaterThan(0);
  });

  it('should get metrics', () => {
    const metrics = node.getMetrics();

    expect(metrics.nodeId).toBe('test-node');
    expect(metrics.healthy).toBe(true);
  });

  it('should list all services', async () => {
    const addFlow = flow((x: number) => x + 1);
    const multiplyFlow = flow((x: number) => x * 2);

    await node.register('add', addFlow);
    await node.register('multiply', multiplyFlow);

    const services = node.getAllServices();
    expect(services.length).toBe(2);
  });
});
