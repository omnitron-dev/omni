import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { runLumenMigrateCli } from '../src/cli/index.js';

describe('Lumen Migrate CLI', () => {
  it('prints version on --version', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runLumenMigrateCli(['--version']);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
    );
    logSpy.mockRestore();
  });

  it('prints usage on --help', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runLumenMigrateCli(['--help']);
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Usage:');
    expect(output).toContain('docusaurus [options] <sourceDir> <targetDir>');
    logSpy.mockRestore();
  });
});
