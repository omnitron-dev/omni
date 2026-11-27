import { expect, it } from 'vitest';
import { checkObservation, checkObservations, digest, encoded, parseStrict, phases } from '../../data/operations/recovery-observations.js';

const prior = { 'main/001': '0'.repeat(64), 'unaffected/001': '5'.repeat(64) };
const added = ['main/002', 'main/003'];
const history = ['main/001', ...added].map((name, i) => ({ name, sha256: String(i + 1).repeat(64) }));
const categories = ['orders', 'awards'];
const challenge = 'neutral-run';
type Observation = { history: typeof history; records: Record<string, Record<string, string>> };

function fixture() {
  const values: Record<string, Record<string, Observation>> = {};
  for (const [scenario, sequence] of Object.entries(phases)) {
    let count = 1;
    const run: Record<string, Observation> = {};
    for (const [phase] of sequence) {
      if (['candidate-partial', 'candidate-write', 'recovery-write'].includes(phase!)) count++;
      const rows = history.slice(0, phase === 'baseline' ? 1 : phase === 'candidate-partial' ? 2 : 3);
      const records = Object.fromEntries(categories.map(name => [name, Object.fromEntries(
        Array.from({ length: count }, (_, i) => [String(i), digest(name + i)]))]));
      const verification = { exitCode: 0, checkedMigrations: rows.length, historySha256: digest(encoded(rows)) };
      const raw = parseStrict(encoded({ challenge, phase, records, history: rows, verification }));
      run[phase!] = checkObservation(raw, { challenge, phase, recordSets: categories });
    }
    values[scenario] = run;
  }
  return values;
}

it('rejects a repeated decoded key before reading its value, including in nested pretty JSON', () => {
  expect(() => parseStrict(' {\n  "a": [ { "name": 1, "\\u006eame":')).toThrow('Duplicate JSON key');
  expect(() => parseStrict('{"__proto__":0,"__proto__":1}')).toThrow('Duplicate JSON key');
  const rows = parseStrict(' [ { "x" : "\\\"x\\\": [}]" }, { "x": 2 } ] ');
  expect(rows).toEqual([{ x: '"x": [}]' }, { x: 2 }]);
  expect(Object.hasOwn(parseStrict('{"__proto__":42}'), '__proto__')).toBe(true);
  expect(() => parseStrict(Buffer.from([0x22, 0xff, 0x22]))).toThrow();
  expect(() => parseStrict('['.repeat(129) + ']'.repeat(129))).toThrow('nesting');
  expect(() => parseStrict('1e400')).toThrow('number');
  expect(() => parseStrict('9007199254740993')).toThrow('number');
});

it('preserves the compact UTF-8 protocol bytes, including numeric IDs and Unicode key ordering', () => {
  const input = { '2': { '😀': 1, '\uE000': 2 }, '10': 'имя\n' };
  expect(encoded(input).toString()).toBe('{"10":"имя\\n","2":{"\uE000":2,"😀":1}}');
});

it('accepts all ten observations, including different source and database migration checksums', () => {
  const values = fixture();
  expect(Object.values(values).flatMap(run => Object.values(run))).toHaveLength(10);
  expect(() => checkObservations(values, added, prior)).not.toThrow();
});

it('rejects a stale challenge, incorrect migrator report, missing coverage or unsafe identifiers', () => {
  const phase = 'baseline';
  const request = { challenge, phase, recordSets: categories };
  const { history: rows, records } = fixture()['full']![phase]!;
  const verification = { exitCode: 0, historySha256: digest(encoded(rows)), checkedMigrations: rows.length };
  const raw = { challenge, phase, history: rows, records, verification };
  expect(() => checkObservation({ ...raw, challenge: 'another' }, request)).toThrow('stale');
  expect(() => checkObservation({ ...raw, history: [rows[0], rows[0]] }, request)).toThrow('history');
  expect(() => checkObservation({ ...raw, verification: { ...verification, exitCode: false } }, request)).toThrow('verification');
  expect(() => checkObservation({ ...raw, verification: { ...verification, historySha256: '0'.repeat(64) } }, request)).toThrow('verification');
  expect(() => checkObservation({ ...raw, records: { orders: {} } }, request)).toThrow('coverage');
  expect(() => checkObservation({ ...raw, records: { ...records, awards: { 'hidden\u200D': '0'.repeat(64) } } }, request)).toThrow('identities');
});

it('detects lost or rewritten records, repeated writes and partial recovery without a new record', () => {
  const lost = fixture();
  delete lost['full']!['recovery-read']!.records['orders']!['1'];
  expect(() => checkObservations(lost, added, prior)).toThrow('protected record changed');
  const changed = fixture();
  changed['full']!['recovery-restart']!.records['awards']!['1'] = digest('other');
  expect(() => checkObservations(changed, added, prior)).toThrow('protected record changed');
  const repeated = fixture();
  repeated['full']!['recovery-replay']!.records['orders']!['extra'] = digest('extra');
  expect(() => checkObservations(repeated, added, prior)).toThrow('duplicate write');
  const partial = fixture();
  partial['partial']!['candidate-partial']!.records = partial['partial']!['baseline']!.records;
  expect(() => checkObservations(partial, added, prior)).toThrow('no new probe record');
  const missing = fixture();
  missing['full']!['recovery-write']!.records['awards'] = missing['full']!['recovery-read']!.records['awards']!;
  expect(() => checkObservations(missing, added, prior)).toThrow('missing new record in awards');
  const interrupted = fixture();
  interrupted['partial']!['candidate-partial']!.history = history;
  expect(() => checkObservations(interrupted, added, prior)).toThrow('candidate-partial: migration history changed');
  const independent = fixture();
  independent['partial']!['baseline']!.history = [{ name: 'main/001', sha256: 'f'.repeat(64) }];
  expect(() => checkObservations(independent, added, prior)).toThrow('Independent baselines disagree');
  expect(() => checkObservations(fixture(), added, { ...prior, 'main/missing': '4'.repeat(64) })).toThrow('inventories');
});
