// Browser shim for Node.js process and setImmediate
export const process = {
  env: { NODE_ENV: 'production' },
  platform: 'browser',
  version: 'v22.0.0',
  cwd: () => '/',
  nextTick: (fn) => Promise.resolve().then(fn)
};

// setImmediate shim (use setTimeout with 0 delay)
export const setImmediate = (fn, ...args) => {
  return setTimeout(() => fn(...args), 0);
};

export const clearImmediate = (id) => {
  return clearTimeout(id);
};

// Inject into globalThis
globalThis.process = process;
globalThis.setImmediate = setImmediate;
globalThis.clearImmediate = clearImmediate;
