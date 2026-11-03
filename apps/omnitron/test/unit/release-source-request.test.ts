import { beforeEach, expect, it, vi } from 'vitest';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

const runner = vi.hoisted(() => vi.fn());
vi.mock('../../src/release/build-run.js', () => ({ runReleaseBuild: runner }));
const { ReleaseService } = await import('../../src/services/release.service.js');
const logger = { info: vi.fn(), error: vi.fn() } as unknown as ILogger;
beforeEach(() => { vi.clearAllMocks(); runner.mockImplementation(() => new Promise(() => {})); });

it('records and forwards the same immutable source selection without mutating caller input', () => {
  const service = new ReleaseService(logger);
  const source = { repository: 'https://forge.example/team/omni.git', ref: 'refs/tags/v2.0.0' };
  const record = service.start({ project: 'sample', frameworkSource: source }, 'operator');
  expect(record.request.frameworkSource).toEqual(source);
  expect(Object.isFrozen(record.request.frameworkSource)).toBe(true);
  expect(runner).toHaveBeenCalledWith('sample', expect.objectContaining({ frameworkSource: source }), expect.any(Function));
  source.repository = 'https://changed.example/other.git';
  expect(record.request.frameworkSource?.repository).toBe('https://forge.example/team/omni.git');
});

it.each([
  { repository: 'https://secret-token@forge.example/omni.git' },
  { repository: 'https://forge.example/omni.git', ref: 'main' },
  { repository: 'https://forge.example/omni.git', unverified: true },
])('rejects an unsafe or ambiguous source before creating any build record', (source) => {
  const service = new ReleaseService(logger);
  expect(() => service.start({ project: 'sample', frameworkSource: source }, 'operator')).toThrow();
  expect(service.builds()).toEqual([]);
  expect(runner).not.toHaveBeenCalled();
  expect(logger.info).not.toHaveBeenCalled();
});
