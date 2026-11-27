import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const phases = {
  full: [['baseline', 'incumbent'], ['candidate-write', 'candidate'], ['recovery-read', 'recovery'],
    ['recovery-write', 'recovery'], ['recovery-replay', 'recovery'], ['recovery-restart', 'recovery']],
  partial: [['baseline', 'incumbent'], ['candidate-partial', 'candidate'],
    ['recovery-complete', 'recovery'], ['recovery-repeat', 'recovery']],
};

export function check(ok, message) {
  if (!ok) throw new Error(message);
}

const maxDepth = 128;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && value.length === 64 && /^[0-9a-f]+$/.test(value);
const hasKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const validText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit * 2 &&
  value.isWellFormed() && [...value].length <= limit;

function parseJson(text) {
  try { return JSON.parse(text); }
  catch { throw new Error('Invalid recovery JSON'); }
}

/** Inspect object keys before the standard JSON parser discards duplicates. */
export function parseStrict(input) {
  const text = typeof input === 'string' ? input : utf8.decode(input);
  const scopes = [];
  for (let i = 0; i < text.length; i++) {
    switch (text[i]) {
      case '{':
      case '[':
        check(scopes.length < maxDepth, 'Recovery JSON exceeds the nesting limit');
        scopes.push(text[i] === '{' ? new Set() : null);
        break;
      case '}':
      case ']':
        scopes.pop();
        break;
      case '"': {
        const start = i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\') i++;
          i++;
        }
        check(i < text.length, 'Invalid recovery JSON string');
        const keys = scopes.at(-1);
        if (!keys) break;
        let next = i + 1;
        while (next < text.length && /[ \t\r\n]/.test(text[next])) next++;
        if (text[next] !== ':') break;
        const key = parseJson(text.slice(start, i + 1));
        check(!keys.has(key), 'Duplicate JSON key');
        keys.add(key);
        break;
      }
    }
  }
  const value = parseJson(text);
  function validate(item) {
    if (typeof item === 'number') {
      check(Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)), 'Invalid or lossy recovery JSON number');
    } else if (Array.isArray(item)) {
      item.forEach(validate);
    } else if (isObject(item)) {
      for (const child of Object.values(item)) validate(child);
    }
  }
  validate(value);
  return value;
}

/** Canonical UTF-8 protocol bytes. Numeric-looking object keys also sort lexically. */
export function encoded(value) {
  function encode(item, depth) {
    check(depth <= maxDepth, 'Recovery JSON exceeds the nesting limit');
    if (Array.isArray(item)) return '[' + item.map(v => encode(v, depth + 1)).join(',') + ']';
    if (isObject(item)) {
      const keys = Object.keys(item).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      return '{' + keys.map(k => encode(k, depth + 1) + ':' + encode(item[k], depth + 1)).join(',') + '}';
    }
    check(item === null || typeof item === 'boolean' || (typeof item === 'string' && item.isWellFormed()) ||
      Number.isSafeInteger(item), 'Invalid value for canonical recovery evidence');
    return JSON.stringify(item);
  }
  return Buffer.from(encode(value, 0));
}

export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function checkObservation(raw, request) {
  check(hasKeys(raw, ['challenge', 'phase', 'history', 'records', 'verification']) &&
    raw.challenge === request.challenge && raw.phase === request.phase, 'Probe returned an invalid observation or a stale challenge');
  const { history, records, verification } = raw;
  check(Array.isArray(history) && history.length > 0 && history.length <= 4096 &&
    history.every(row => hasKeys(row, ['name', 'sha256']) && validText(row.name, 1024) && hash(row.sha256)) &&
    new Set(history.map(r => r.name)).size === history.length, 'Invalid measured migration history');
  check(hasKeys(verification, ['exitCode', 'historySha256', 'checkedMigrations']) && verification.exitCode === 0 &&
    verification.checkedMigrations === history.length && verification.historySha256 === digest(encoded(history)),
  'Native migration verification did not confirm this measured history');
  check(hasKeys(records, request.recordSets), 'Incomplete record coverage');
  for (const group of Object.values(records)) {
    check(isObject(group) && Object.keys(group).length <= 512 && Object.entries(group).every(([key, sum]) =>
      validText(key, 256) && !/[\p{C}\p{Z}]/u.test(key.replaceAll(' ', '')) && hash(sum)), 'Invalid measured record identities or content digests');
  }
  return { history, records };
}

export function checkObservations(values, added, prior) {
  check(added.length >= 2, 'Partial qualification requires at least two new migrations');
  const baseline = values.full.baseline.history;
  const names = new Set(baseline.map(row => row.name));
  const directories = new Set(added.map(name => posix.dirname(name)));
  const priorNames = prior instanceof Set ? prior : new Set(Object.keys(prior));
  check([...names].every(name => priorNames.has(name)) &&
    [...priorNames].every(name => !directories.has(posix.dirname(name)) || names.has(name)),
  'Baseline history does not cover the affected release migration inventories');
  const migrated = values.full['candidate-write'].history;
  const additions = migrated.slice(baseline.length);
  check(isDeepStrictEqual(migrated.slice(0, baseline.length), baseline) && isDeepStrictEqual(additions.map(row => row.name), added),
    'Observed candidate migration sequence differs');

  for (const [scenario, sequence] of Object.entries(phases)) {
    const seen = values[scenario];
    check(!seen.baseline.history.some(row => added.includes(row.name)), 'Baseline already has candidate migrations');
    check(Object.values(seen.baseline.records).some(rows => Object.keys(rows).length > 0), 'No baseline records were seeded');
    check(isDeepStrictEqual(seen.baseline.history, baseline), 'Independent baselines disagree about the migration history');
    let previous;
    for (const [phase] of sequence) {
      const item = seen[phase];
      const extra = phase === 'baseline' ? [] : phase === 'candidate-partial' ? additions.slice(0, 1) : additions;
      check(isDeepStrictEqual(item.history, [...baseline, ...extra]), scenario + '/' + phase + ': migration history changed');
      if (previous) {
        let grew = false;
        for (const [name, before] of Object.entries(previous.records)) {
          const after = item.records[name];
          check(Object.entries(before).every(([id, sum]) => Object.hasOwn(after, id) && after[id] === sum), phase + ': a protected record changed');
          const larger = Object.keys(after).length > Object.keys(before).length;
          grew ||= larger;
          if (phase === 'candidate-write' || phase === 'recovery-write') check(larger, phase + ': missing new record in ' + name);
          else if (phase !== 'candidate-partial' && phase !== 'recovery-complete') check(!larger, phase + ': unexpected record or duplicate write in ' + name);
        }
        if (phase === 'candidate-partial') check(grew, 'Partial migration produced no new probe record');
      }
      previous = item;
    }
  }
}
