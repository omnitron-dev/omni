import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runLumenCli } from '@omnitron-dev/lumen';
import { cliRunner } from '../harness/cli-runner.js';

describe('Feature 23: Lumen CLI Suite Boundaries', () => {
  it('TC-B23-01: handles empty arguments array by displaying usage help', async () => {
    const result = await cliRunner.runLumen([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Commands:');
    expect(result.stdout).toContain('dev');
    expect(result.stdout).toContain('build');
  });

  it('TC-B23-02: rejects unknown command argument with nonzero exit code without uncaught exception', async () => {
    const result = await cliRunner.runLumen(['unrecognized-subcommand-404']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown command: unrecognized-subcommand-404');
  });

  it('TC-B23-03: handles lumen build with custom outDir and flag arguments', async () => {
    const customOutDir = mkdtempSync(join(tmpdir(), 'lumen-b23-dist-'));
    try {
      const result = await cliRunner.runLumen(['build', '--outDir', customOutDir]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('command: build');
    } finally {
      rmSync(customOutDir, { recursive: true, force: true });
    }
  });

  it('TC-B23-04: handles lumen check with format flags', async () => {
    const result = await cliRunner.runLumen(['check', '--format=json']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command: check');
  });

  it('TC-B23-05: dispatches lumen pdf and mcp commands safely via programmatic runner', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      await runLumenCli(['pdf']);
      await runLumenCli(['mcp']);
      expect(logs.some((l) => l.includes('command: pdf'))).toBe(true);
      expect(logs.some((l) => l.includes('command: mcp'))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });
});
