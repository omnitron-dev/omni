import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgress, emitJson } from '../../src/commands/output.js';
import { resetEnvCache, setEnvOverride } from '../../src/shared/env-config.js';

const terminal = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
afterEach(() => {
  resetEnvCache();
  vi.restoreAllMocks();
  if (terminal) Object.defineProperty(process.stdout, 'isTTY', terminal);
  else Reflect.deleteProperty(process.stdout, 'isTTY');
});

function capture() {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    chunks.push(String(chunk));
    return true;
  });
  return () => chunks.join('');
}

describe('command progress through Xec Kit', () => {
  it('prints readable transitions to a pipe and clears without repeating the last message', () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'human' });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const output = capture();
    const progress = createProgress();
    try {
      progress.start('Restarting payments');
      progress.message('Waiting for readiness');
      progress.message('Waiting for readiness');
      progress.clear();
    } finally { progress.clear(); }
    expect(output()).toBe('Restarting payments\nWaiting for readiness\n');
  });

  it('keeps machine output parseable without terminal hooks or animation', () => {
    setEnvOverride({ OMNITRON_OUTPUT: 'json' });
    const output = capture();
    const hooks = process.listenerCount('SIGINT');
    const progress = createProgress();
    try {
      progress.start('Resizing pool');
      progress.message('Waiting');
      progress.stop('Ready');
      expect(process.listenerCount('SIGINT')).toBe(hooks);
      emitJson({ instances: 3 });
      expect(output()).toBe('{"ok":true,"data":{"instances":3}}\n');
    } finally { progress.clear(); }
  });
});
