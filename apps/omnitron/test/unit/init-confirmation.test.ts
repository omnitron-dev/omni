import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prompt = vi.hoisted(() => ({ confirm: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock('@xec-sh/kit', () => ({ confirm: prompt.confirm, log: prompt }));
import { initCommand } from '../../src/commands/init.js';

let directory: string;
let file: string;
const originalExitCode = process.exitCode;
const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-init-confirmation-'));
  file = path.join(directory, 'omnitron.config.ts');
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  vi.clearAllMocks();
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  process.exitCode = originalExitCode;
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('configuration overwrite admission', () => {
  it.each([false, Symbol('cancel')])('preserves existing content after %s', async (reply) => {
    fs.writeFileSync(file, 'original');
    prompt.confirm.mockResolvedValue(reply);
    await initCommand();
    expect(fs.readFileSync(file, 'utf8')).toBe('original');
    expect(prompt.success).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(typeof reply === 'symbol' ? 130 : undefined);
  });

  it('refuses a noninteractive overwrite before prompting', async () => {
    fs.writeFileSync(file, 'original');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
    await expect(initCommand()).rejects.toThrow('--force');
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toBe('original');
  });

  it('supports explicit overwrite in automation', async () => {
    fs.writeFileSync(file, 'original');
    await initCommand({ force: true });
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toContain('defineEcosystem');
  });

  it('creates a new config without confirmation', async () => {
    await initCommand();
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, 'utf8')).toContain('defineEcosystem');
  });

  it('preserves a symlink target even when overwrite is explicit', async () => {
    const target = path.join(directory, 'target.ts');
    fs.writeFileSync(target, 'original');
    fs.symlinkSync(target, file);
    await expect(initCommand({ force: true })).rejects.toThrow('symbolic link');
    expect(fs.readFileSync(target, 'utf8')).toBe('original');
  });
});
