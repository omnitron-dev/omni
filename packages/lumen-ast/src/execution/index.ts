import variant from '@jitl/quickjs-singlefile-browser-release-sync';
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSHandle } from 'quickjs-emscripten-core';

import { PLAYGROUND_LIMITS } from './limits.js';
export { PLAYGROUND_LIMITS } from './limits.js';

/**
 * Evaluate documentation JavaScript in a fresh WASM interpreter with no host
 * functions, module loader, network, filesystem or DOM. Call inside a Worker
 * for an independent wall-clock termination boundary as well as these limits.
 */
export async function evaluatePlayground(code: string, timeoutMs: number = PLAYGROUND_LIMITS.timeoutMs): Promise<unknown> {
  if (typeof code !== 'string' || new TextEncoder().encode(code).length > PLAYGROUND_LIMITS.codeBytes)
    throw new Error(`Playground code exceeds ${PLAYGROUND_LIMITS.codeBytes} bytes`);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PLAYGROUND_LIMITS.maxTimeoutMs)
    throw new Error(`Execution timeout must be between 1 and ${PLAYGROUND_LIMITS.maxTimeoutMs} ms`);
  // The allocator's quota alone does not bound aggregate allocations. Enforce
  // the ceiling on WASM memory itself, with a fresh heap for every execution.
  const pages = PLAYGROUND_LIMITS.memoryBytes / 65_536;
  const memory = new WebAssembly.Memory({ initial: pages, maximum: pages });
  const engine = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: memory }));
  if (engine.getWasmMemory() !== memory) throw new Error('Interpreter memory boundary was not installed');
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(PLAYGROUND_LIMITS.memoryBytes);
  runtime.setMaxStackSize(PLAYGROUND_LIMITS.stackBytes);
  const deadline = performance.now() + timeoutMs;
  runtime.setInterruptHandler(() => performance.now() >= deadline);
  const vm = runtime.newContext();
  const owned: QuickJSHandle[] = [];
  const own = (value: QuickJSHandle) => { owned.push(value); return value; };
  try {
    // This closure retains pristine guest intrinsics. Nothing callable from the
    // guest is implemented in the host, including console and serialization.
    const serialize = own(vm.unwrapResult(vm.evalCode(`(() => {
      const stringify = JSON.stringify, string = String;
      const lines = []; let count = 0;
      const log = (...args) => {
        const line = args.map(v => typeof v === 'string' ? v : stringify(v)).join(' ');
        count += line.length;
        if (count > ${PLAYGROUND_LIMITS.resultBytes}) throw new Error('Console output limit exceeded');
        lines.push(line);
      };
      Object.defineProperty(globalThis, 'console', { value: Object.freeze({log, info: log, warn: log, error: log}), writable: false });
      return value => {
        if (value === undefined) value = lines.join('\\n');
        if (typeof value === 'bigint') value = string(value);
        const output = stringify(value);
        if (output === undefined) throw new Error('Result must be JSON serializable');
        if (output.length > ${PLAYGROUND_LIMITS.resultBytes}) throw new Error('Result size limit exceeded');
        return output;
      };
    })()`)));
    let source = code;
    const compiled = vm.evalCode(source, 'playground.js', { type: 'global', compileOnly: true });
    if (compiled.error) {
      compiled.error.dispose();
      // Function-body snippets support return and await. Compilation failed
      // before any instruction ran; runtime errors are never retried.
      source = `(async () => {\n${code}\n})()`;
    } else compiled.value.dispose();
    let result = own(vm.unwrapResult(vm.evalCode(source, 'playground.js', { type: 'global' })));
    for (let jobs = 0; ; jobs++) {
      const state = vm.getPromiseState(result);
      if (state.type === 'fulfilled') {
        if (!state.notAPromise) result = own(state.value);
        break;
      }
      if (state.type === 'rejected') {
        const failure = own(state.error);
        const message = own(vm.getProp(failure, 'message'));
        throw new Error(vm.getString(message).slice(0, 2048) || 'Playground promise rejected');
      }
      if (jobs >= PLAYGROUND_LIMITS.jobs || performance.now() >= deadline) throw new Error('Execution timed out');
      const completed = vm.unwrapResult(runtime.executePendingJobs(1));
      if (completed === 0) throw new Error('Promise cannot settle without unavailable host capabilities');
    }
    const encoded = own(vm.unwrapResult(vm.callFunction(serialize, vm.undefined, result)));
    const text = vm.getString(encoded);
    if (new TextEncoder().encode(text).length > PLAYGROUND_LIMITS.resultBytes) throw new Error('Result size limit exceeded');
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (performance.now() >= deadline) throw new Error(`Execution timed out after ${timeoutMs}ms`, { cause: error });
    throw error;
  } finally {
    for (const value of owned.reverse()) value.dispose();
    vm.dispose();
    runtime.dispose();
  }
}
