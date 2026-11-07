import type { Command } from '@xec-sh/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@xec-sh/core', async original => {
  const xec = await original<typeof import('@xec-sh/core')>();
  return {
    ...xec,
    DockerAdapter: class extends xec.DockerAdapter {
      protected override executeDockerCommand(args: string[], command: Partial<Command>) {
        return native.execute(args, command);
      }
    },
  };
});

import { stopContainer } from '../../src/infrastructure/container-runtime.js';

beforeEach(() => {
  native.execute.mockReset().mockResolvedValue({ stdout: '', stderr: '', stdall: '', exitCode: 0, signal: null });
});

describe('Omnitron stop through the registry Xec adapter', () => {
  it.each([0, 45, 600])('preserves the requested %s-second grace period and allows acknowledgement time', async timeout => {
    await stopContainer('owned-container', timeout);
    expect(native.execute).toHaveBeenCalledWith(['stop', '--timeout', String(timeout), '--', 'owned-container'],
      expect.objectContaining({ timeout: expect.any(Number) }));
    expect(native.execute.mock.calls[0]![1].timeout).toBeGreaterThan(timeout * 1000);
  });

  it('keeps the public ten-second default', async () => {
    await stopContainer('owned-container');
    expect(native.execute.mock.calls[0]![0]).toEqual(['stop', '--timeout', '10', '--', 'owned-container']);
  });

  it.each([-1, 0.5, 601, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid timeout %s before executing Docker', async timeout => {
    await expect(stopContainer('owned-container', timeout)).rejects.toThrow('Stop timeout must be an integer');
    expect(native.execute).not.toHaveBeenCalled();
  });

  it('does not acknowledge a Docker refusal as a successful stop', async () => {
    native.execute.mockResolvedValue({ stdout: '', stderr: 'daemon unavailable', stdall: '', exitCode: 1, signal: null });
    await expect(stopContainer('owned-container', 45)).rejects.toThrow('daemon unavailable');
  });
});
