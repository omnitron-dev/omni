import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { runLumenCli } from '@omnitron-dev/lumen';
import { cliRunner } from '../harness/cli-runner.js';

describe('Feature 23: Lumen CLI Suite', () => {
  it('TC-F23-01: executes lumen --version and prints semantic version', async () => {
    const result = await cliRunner.runLumen(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/0\.\d+\.\d+/);
  });

  it('TC-F23-02: executes lumen --help and outputs catalog of available commands', async () => {
    const result = await cliRunner.runLumen(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Commands:');
    expect(result.stdout).toContain('dev');
    expect(result.stdout).toContain('build');
    expect(result.stdout).toContain('check');
    expect(result.stdout).toContain('pdf');
    expect(result.stdout).toContain('mcp');
  });

  it('TC-F23-03: invokes runLumenCli programmatically without error', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      await runLumenCli(['--help']);
      expect(logs.some((l) => l.includes('Lumen CLI'))).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it('TC-F23-04: dispatches lumen check command', async () => {
    const result = await cliRunner.runLumenCheck();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('command: check');
  });

  it('TC-F23-05: dispatches lumen build command with custom output directory argument', async () => {
    const customOutDir = mkdtempSync(join(tmpdir(), 'lumen-f23-dist-'));
    try {
      const result = await cliRunner.runLumenBuild({ outputDir: customOutDir });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('command: build');
    } finally {
      rmSync(customOutDir, { recursive: true, force: true });
    }
  });
});
