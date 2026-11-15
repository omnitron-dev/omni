import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionOutcomeUnknownError } from '@xec-sh/core';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionService } from '../../src/execution/execution.service.js';

const services: ExecutionService[] = [];
const service = () => { const value = new ExecutionService(createNullLogger()); services.push(value); return value; };
afterEach(async () => { await Promise.all(services.splice(0).map(value => value.dispose())); });

describe('canonical execution lifecycle', () => {
  it('runs concurrent real local commands through one lazily initialized engine', async () => {
    const value = service();
    const results = await Promise.all(['one', 'two'].map(word => value.exec(`printf ${word}`)));
    expect(results.map(result => result.stdout)).toEqual(['one', 'two']);
    expect(value.isAvailable()).toBe(true);
    expect(await value.exec('printf partial; exit 7')).toMatchObject({ stdout: 'partial', exitCode: 7 });
    await value.dispose();
    await expect(value.exec('true')).rejects.toThrow('disposed');
  });

  it('never converts an unknown remote outcome into an ordinary failed exit', async () => {
    const value = service();
    const failure = new ExecutionOutcomeUnknownError({ adapter: 'ssh', cause: new Error('lost acknowledgement') });
    vi.spyOn(value, 'execute').mockRejectedValue(failure);
    await expect(value.ssh({ host: 'fixture.invalid' }, 'effect')).rejects.toBe(failure);
    await expect(value.exec('effect')).rejects.toBe(failure);
  });
});
