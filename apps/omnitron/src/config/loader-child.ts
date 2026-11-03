/** Evaluate the real configuration URL once, with its complete native module graph.
 * Factory execution is local to this child; only declarative data crosses IPC. */
import { pathToFileURL } from 'node:url';
import { initializeModuleReader, answerModuleRead } from '../shared/fresh-module-reader.js';

initializeModuleReader();

/** Preserve optional undefined values; refuse lossy values instead of silently
 * stripping functions, invoking getters/toJSON or changing class instances. */
function configurationData(value: unknown, field = 'config', reading = new Set<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw Error(`Ecosystem ${field} must contain only declarative data`);
  if (reading.has(value)) throw Error(`Ecosystem ${field} contains a cycle`);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null)
    throw Error(`Ecosystem ${field} must be a plain object`);
  if (Object.getOwnPropertySymbols(value).length) throw Error(`Ecosystem ${field} has unsupported symbol keys`);
  reading.add(value);
  try {
    const result = array ? [] : Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (array && key === 'length') continue;
      if (!Object.hasOwn(descriptor, 'value')) throw Error(`Ecosystem ${field}.${key} cannot be an accessor`);
      if (!descriptor.enumerable) throw Error(`Ecosystem ${field}.${key} must be enumerable`);
      Object.defineProperty(result, key, { value: configurationData(descriptor.value, `${field}.${key}`, reading),
        enumerable: true, configurable: true, writable: true });
    }
    if (array) result.length = (value as unknown[]).length;
    return result;
  } finally { reading.delete(value); }
}

try {
  const file = process.argv[2], phase = process.argv[3];
  if (!file || (phase !== 'runtime' && phase !== 'release')) throw Error('Invalid ecosystem read request');
  const mod = await import(pathToFileURL(file).href);
  const exported = mod.default ?? { ...mod };
  const raw = typeof exported === 'function' ? await exported(Object.freeze({ phase })) : exported;
  answerModuleRead({ ok: true, value: configurationData(raw) });
} catch (error) { answerModuleRead({ ok: false, error }); }
