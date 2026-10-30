import { describe, expect, it } from 'vitest';
import { schemaExpansionCovers, validateSchemaExpansionReceipt, type SchemaExpansionReceipt } from '../../src/database/schema-compatibility.js';

const runtime = 'a'.repeat(64), database = 'b'.repeat(64), checksum = 'c'.repeat(64);
const files = { '001_initial': 'd'.repeat(64) };
const records = [{ name: '002_expansion', checksum, executedAt: new Date() }];
const receipt = (): SchemaExpansionReceipt => ({ protocol: 1, id: '00000000-0000-4000-8000-000000000001',
  kind: 'master-expand', phase: 'approved', instanceHome: '/private/fixture', fromRuntime: runtime,
  toRuntime: 'e'.repeat(64), database, baseFiles: files, additions: [{ name: records[0]!.name, checksum, fileHash: 'f'.repeat(64) }],
  approvedAt: new Date().toISOString() });

describe('schema expansion compatibility evidence', () => {
  it('recognizes only the exact runtime, database, immutable base files and committed checksum', () => {
    const approved = receipt();
    expect(schemaExpansionCovers(approved, runtime, files, database, records)).toBe(true);
    expect(schemaExpansionCovers(approved, 'f'.repeat(64), files, database, records)).toBe(false);
    expect(schemaExpansionCovers(approved, runtime, files, 'f'.repeat(64), records)).toBe(false);
    expect(schemaExpansionCovers(approved, runtime, { '001_initial': '0'.repeat(64) }, database, records)).toBe(false);
    expect(schemaExpansionCovers(approved, runtime, {}, database, records)).toBe(false);
    expect(schemaExpansionCovers(approved, runtime, { ...files, '000_extra': files['001_initial'] }, database, records)).toBe(false);
    expect(schemaExpansionCovers(approved, runtime, files, database, [{ ...records[0]!, checksum: '0'.repeat(64) }])).toBe(false);
    expect(schemaExpansionCovers(approved, runtime, files, database, [{ ...records[0]!, checksum: null }])).toBe(false);
    expect(schemaExpansionCovers(approved, runtime, files, database, [...records, { name: '003_unreviewed', checksum, executedAt: new Date() }])).toBe(false);
  });
  it('requires an explicit bounded receipt rather than a wildcard or a general downgrade flag', () => {
    expect(() => validateSchemaExpansionReceipt({ ...receipt(), phase: 'prepared' })).toThrow('Invalid');
    expect(() => validateSchemaExpansionReceipt({ ...receipt(), kind: 'contract' })).toThrow('Invalid');
    expect(() => validateSchemaExpansionReceipt({ ...receipt(), additions: [{ ...receipt().additions[0], name: '*' }] })).toThrow('Invalid');
    expect(() => validateSchemaExpansionReceipt({ ...receipt(), additions: Array(101).fill(receipt().additions[0]) })).toThrow('Invalid');
    expect(() => validateSchemaExpansionReceipt({ ...receipt(), additions: [receipt().additions[0], receipt().additions[0]] })).toThrow('Invalid');
    expect(() => validateSchemaExpansionReceipt({ ...receipt(), phase: 'applied' })).toThrow('Invalid');
    expect(() => validateSchemaExpansionReceipt({ ...receipt(), fromRuntime: receipt().toRuntime })).toThrow('Invalid');
  });
  it('can recognize an atomic schema commit after a coordinator dies before writing its applied receipt', () => {
    const approved = receipt();
    expect(schemaExpansionCovers(approved, runtime, files, database, records)).toBe(true);
    expect(schemaExpansionCovers({ ...approved, phase: 'applied', appliedAt: new Date().toISOString() }, runtime, files, database, records)).toBe(true);
  });
});
