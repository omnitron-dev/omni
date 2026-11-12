import { afterEach, expect, it, vi } from 'vitest';

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
});

it('does not run commands when imported by another cli/index.js entry', async () => {
  vi.resetModules();
  process.argv = [process.execPath, '/consumer/cli/index.js', '--version'];
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { runLumenCli } = await import('../src/cli/index.js');
  expect(log).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  await runLumenCli(['--version']);
  expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^\d+\.\d+\.\d+/));
});
