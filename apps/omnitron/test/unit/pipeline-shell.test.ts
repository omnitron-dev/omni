import { describe, it, expect } from 'vitest';
import { Pipeline } from '@xec-sh/ops';
import { PipelineOutput } from '../../src/services/pipeline.service.js';
import {
  PIPELINE_LIMITS,
  pipelineCondition,
  validatePipeline,
  validatePipelineParams,
} from '../../src/services/pipeline-definition.js';

const run = async (command: string, timeout = 10_000, signal?: AbortSignal) =>
  (
    await Pipeline.create('step')
      .step('inspect', { run: command, timeout })
      .run({}, { outputLimit: PIPELINE_LIMITS.outputBytes, ...(signal ? { signal } : {}) })
  ).steps[0]!;

describe('Omnitron uses the Xec step executor', () => {
  it('keeps both output streams on success', async () => {
    expect(await run('echo out; echo warning >&2')).toMatchObject({
      success: true,
      stdout: 'out\n',
      stderr: 'warning\n',
    });
  });
  it('does not fail verbose builds and explicitly reports limited retention', async () => {
    const result = await run('yes 0123456789abcdef | head -c 2000000; exit 0');
    expect(result.success).toBe(true);
    expect(result.outputTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(PIPELINE_LIMITS.outputBytes);
  });
  it('preserves failure stderr and exit status', async () => {
    expect(await run('echo missing-script >&2; exit 3')).toMatchObject({
      success: false,
      exitCode: 3,
      stderr: 'missing-script\n',
    });
  });
  it('classifies timeout and abort as unsuccessful', async () => {
    expect((await run('sleep 5', 100)).success).toBe(false);
    const abort = new AbortController();
    const work = run('sleep 5', 10000, abort.signal);
    setTimeout(() => abort.abort(), 100);
    expect(await work).toMatchObject({ success: false, cancelled: true });
  });
  it('does not report a missing executable as success', async () => {
    expect((await run('definitely-not-an-executable')).success).toBe(false);
  });
});

describe('pipeline admission and diagnostics', () => {
  it('rejects unsupported conditions and unsafe parameter interpolation', () => {
    expect(() => pipelineCondition('runAnything()', {})).toThrow('Unsupported');
    expect(pipelineCondition('params.confirm == "yes"', { confirm: 'yes' })).toBe(true);
    expect(() => validatePipeline({ name: 'unsafe', steps: [{ name: 'one', run: 'echo {{payload}}' }] })).toThrow(
      'interpolation'
    );
    expect(() => validatePipelineParams({ payload: { nested: true } })).toThrow('scalar');
    expect(() => validatePipelineParams({ invalid: NaN })).toThrow('scalar');
  });
  it('redacts secrets even when they span stream boundaries', () => {
    const out = new PipelineOutput(['sensitive-value']);
    out.append('output\nsensitive-');
    expect(out.snapshot()).not.toContain('sensitive-');
    out.append('value\nfinished\n');
    expect(out.snapshot(true)).toBe('output\n***\nfinished\n');
  });
  it('reports retention loss even inside the extra secret-matching buffer', () => {
    const out = new PipelineOutput(['sensitive-value']);
    out.append('a\n'.repeat(PIPELINE_LIMITS.outputBytes / 2 + 1));
    expect(Buffer.byteLength(out.snapshot(true))).toBeLessThanOrEqual(PIPELINE_LIMITS.outputBytes);
    expect(out.truncated).toBe(true);
  });
  it('never releases private key contents after retention removes the opening marker', () => {
    const out = new PipelineOutput([]);
    out.append('-----BEGIN PRIVATE KEY-----\n');
    for (let i = 0; i < 100; i++) out.append('private-material'.repeat(100) + '\n');
    expect(out.snapshot(true)).not.toContain('private-material');
    out.append('-----END PRIVATE ');
    out.append('KEY-----\nsafe-result\n');
    expect(out.snapshot(true)).toContain('safe-result');
    expect(out.snapshot(true)).not.toContain('private-material');
  });
});
