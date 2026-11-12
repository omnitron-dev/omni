/** The JSON data contract shared by SSR island hosts and the browser runtime. */
export const MAX_ISLAND_PROPS_BYTES = 256 * 1024;
const MAX_DEPTH = 64;
const encoder = new TextEncoder();

export type HydrationTrigger = 'load' | 'visible' | 'interaction' | 'idle' | `on${string}`;

export function parseHydrationTrigger(value: unknown): HydrationTrigger {
  if (value === 'load' || value === 'visible' || value === 'interaction' || value === 'idle') return value;
  if (typeof value === 'string' && value.startsWith('on') && value.length > 2 && !/\s/.test(value) &&
    ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return value as HydrationTrigger;
  throw new TypeError('Invalid island hydration trigger');
}

function copyJsonProps(value: unknown): Record<string, unknown> {
  let bytes = 0;
  const ancestors = new Set<object>();
  const spend = (count: number) => {
    bytes += count;
    if (bytes > MAX_ISLAND_PROPS_BYTES) throw new RangeError('Island props exceed 256 KiB');
  };
  const stringBytes = (text: string) => {
    if (text.length > MAX_ISLAND_PROPS_BYTES) throw new RangeError('Island props exceed 256 KiB');
    return encoder.encode(JSON.stringify(text)).byteLength;
  };
  const copy = (input: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new RangeError('Island props exceed 64 nested levels');
    if (input === null) { spend(4); return null; }
    if (typeof input === 'string') { spend(stringBytes(input)); return input; }
    if (typeof input === 'boolean') { spend(input ? 4 : 5); return input; }
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || Object.is(input, -0)) throw new TypeError('Island props require finite JSON numbers without negative zero');
      spend(String(input).length); return input;
    }
    if (typeof input !== 'object') throw new TypeError('Island props must contain only JSON data');
    if (ancestors.has(input)) throw new TypeError('Island props must not contain cycles');
    const array = Array.isArray(input);
    if (!array && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
      throw new TypeError('Island props require plain objects and arrays');
    ancestors.add(input);
    try {
      spend(2);
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some(key => typeof key === 'symbol')) throw new TypeError('Island props must not contain symbol keys');
      const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
      // JSON.stringify must not discover an inherited toJSON hook while encoding the validated copy.
      if (array) Object.setPrototypeOf(output, null);
      let index = 0;
      for (const key of keys as string[]) {
        if (array && key === 'length') continue;
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Island props must use enumerable data properties');
        if (array && key !== String(index)) throw new TypeError('Island props require dense arrays without additional properties');
        spend((index ? 1 : 0) + (array ? 0 : stringBytes(key) + 1));
        (output as Record<string, unknown>)[key] = copy(descriptor.value, depth + 1);
        index++;
      }
      if (array && index !== (input as unknown[]).length) throw new TypeError('Island props require dense arrays');
      return output;
    } finally { ancestors.delete(input); }
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Island props must be a JSON object');
  return copy(value, 0) as Record<string, unknown>;
}

export function serializeIslandProps(props: unknown): string {
  return JSON.stringify(copyJsonProps(props));
}

export function parseIslandProps(serialized: string): Record<string, unknown> {
  if (serialized.length > MAX_ISLAND_PROPS_BYTES || encoder.encode(serialized).byteLength > MAX_ISLAND_PROPS_BYTES)
    throw new RangeError('Island props exceed 256 KiB');
  const parsed: unknown = JSON.parse(serialized);
  copyJsonProps(parsed);
  return parsed as Record<string, unknown>;
}
