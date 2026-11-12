import { describe, expect, it } from 'vitest';
import { evaluatePlayground } from '../src/execution/index.js';

describe('capability-free playground interpreter', () => {
  it('evaluates expressions, return snippets, promises and console output', async () => {
    expect(await evaluatePlayground('21 * 2')).toBe(42);
    expect(await evaluatePlayground('const value = await Promise.resolve(6); return value * 7')).toBe(42);
    expect(await evaluatePlayground('console.log("hello", {value:42})')).toBe('hello {"value":42}');
  });
  it('does not expose host capabilities even through constructors', async () => {
    expect(await evaluatePlayground('Function("return [typeof process, typeof require, typeof fetch, typeof globalThis.Worker, typeof document, typeof WebAssembly]")()'))
      .toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
    await expect(evaluatePlayground('import("node:fs")')).rejects.toThrow();
    await expect(evaluatePlayground('fetch("https://example.com")')).rejects.toThrow();
  });
  it('isolates globals and prototypes across invocations and from the host', async () => {
    await evaluatePlayground('Object.prototype.__lumenProbe = 42; globalThis.process = {owned:true}; 1');
    expect(await evaluatePlayground('[({}).__lumenProbe ?? null, typeof process]')).toEqual([null, 'undefined']);
    expect(Object.prototype).not.toHaveProperty('__lumenProbe');
  });
  it('bounds synchronous loops, microtasks and guest allocations, then recovers', async () => {
    await expect(evaluatePlayground('while(true) {}', 30)).rejects.toThrow();
    await expect(evaluatePlayground('async function repeat(){await 0; return repeat()} repeat()', 30)).rejects.toThrow();
    await expect(evaluatePlayground('const xs=[]; while(true) xs.push(new Array(100000).fill(1))', 100)).rejects.toThrow();
    expect(await evaluatePlayground('42')).toBe(42);
  });
  it('enforces aggregate memory independently of the interpreter allocator quota', async () => {
    await expect(evaluatePlayground('const chunks=[]; for(let i=0;i<500;i++) chunks.push(new Array(250000).fill("chunk-"+i)); chunks.length'))
      .rejects.toThrow();
    expect(await evaluatePlayground('42')).toBe(42);
  });
  it('rejects pending promises, invalid syntax and oversized input/output explicitly', async () => {
    await expect(evaluatePlayground('new Promise(() => {})')).rejects.toThrow('cannot settle');
    await expect(evaluatePlayground('const =')).rejects.toThrow();
    await expect(evaluatePlayground(' '.repeat(65537))).rejects.toThrow('code exceeds');
    await expect(evaluatePlayground('"x".repeat(100000)')).rejects.toThrow();
    await expect(evaluatePlayground('({toJSON(){while(true){}}})', 30)).rejects.toThrow();
  });
});
