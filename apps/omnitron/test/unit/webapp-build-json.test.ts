import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';
const runtime = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: runtime.exec }));
import { webappBuildCommand } from '../../src/commands/webapp.js';
let output: string[], errors: string[];
beforeEach(() => {
  runtime.exec.mockReset(); setEnvOverride({ OMNITRON_OUTPUT: 'json' }); process.exitCode = undefined;
  const exists = fs.existsSync.bind(fs);
  vi.spyOn(fs, 'existsSync').mockImplementation(file => /\/(scripts\/build-console\.mjs|webapp\/src|webapp\/dist)$/.test(String(file)) || exists(file));
  output = []; errors = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => { errors.push(String(chunk)); return true; });
});
afterEach(() => { vi.restoreAllMocks(); resetEnvCache(); process.exitCode = undefined; });
describe('build subprocess output stays inside the lifecycle result boundary', () => {
  it('captures Vite and nested builder prose without contaminating stdout', async () => {
    runtime.exec.mockImplementation((_command, args, options, callback) => {
      expect(args[0]).toMatch(/scripts\/build-console\.mjs$/);
      expect(options.stdio).toBeUndefined();
      callback(null, '\u001b[32mVite built 50 chunks\u001b[0m\n', 'builder diagnostics\n');
    });
    await webappBuildCommand(); expect(runtime.exec).toHaveBeenCalledOnce(); expect(errors).toEqual([]);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output.join(''))).toMatchObject({ ok: true, data: { operation: 'build', durationMs: expect.any(Number) } });
    expect(output.join('')).not.toContain('Vite');
  });
  it('encodes build stderr inside one structured failure', async () => {
    runtime.exec.mockImplementation((_command, _args, _options, callback) => callback(Object.assign(Error('Build failed'), { stderr: 'compiler failure\nline two' })));
    await webappBuildCommand(); expect(output).toEqual([]); expect(errors).toHaveLength(1);
    expect(JSON.parse(errors.join(''))).toMatchObject({ ok: false, operation: 'build', error: expect.stringContaining('compiler failure\nline two') });
    expect(process.exitCode).toBe(1);
  });
});
