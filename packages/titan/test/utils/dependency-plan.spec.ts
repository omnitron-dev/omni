import { describe, expect, it } from 'vitest';
import { dependencyBatches, DependencyGraphError } from '../../src/utils/dependency-plan.js';

type Item = { name: string; dependencies: string[] };
const select = { name: (item: Item) => item.name, dependencies: (item: Item) => item.dependencies };
describe('dependency planning', () => {
  it('keeps independent nodes together, deduplicates edges and does not mutate input', () => {
    const items = [
      { name: 'route', dependencies: ['api'] },
      { name: 'db', dependencies: [] },
      { name: 'cache', dependencies: [] },
      { name: 'api', dependencies: ['db', 'cache', 'db'] },
    ];
    const before = structuredClone(items);
    expect(dependencyBatches(items, select).map((batch) => batch.map((item) => item.name))).toEqual([
      ['db', 'cache'],
      ['api'],
      ['route'],
    ]);
    expect(items).toEqual(before);
    expect(dependencyBatches([], select)).toEqual([]);
  });
  it('rejects duplicate identities, absent prerequisites and cycles with structured reasons', () => {
    const cases = [
      {
        code: 'duplicate-node',
        items: [
          { name: 'a', dependencies: [] },
          { name: 'a', dependencies: [] },
        ],
      },
      { code: 'missing-dependency', items: [{ name: 'a', dependencies: ['absent'] }] },
      {
        code: 'cycle',
        items: [
          { name: 'a', dependencies: ['b'] },
          { name: 'b', dependencies: ['a'] },
        ],
      },
      { code: 'cycle', items: [{ name: 'a', dependencies: ['a'] }] },
    ];
    for (const { items, code } of cases) {
      expect(() => dependencyBatches(items, select)).toThrow(DependencyGraphError);
      try {
        dependencyBatches(items, select);
      } catch (error) {
        expect(error).toMatchObject({ code });
      }
    }
  });
  it('handles long dependency chains without recursion or repeated graph scans', () => {
    const items = Array.from({ length: 20000 }, (_, index) => ({
      name: String(index),
      dependencies: index ? [String(index - 1)] : [],
    }));
    const plan = dependencyBatches(items, select);
    expect(plan).toHaveLength(items.length);
    expect(plan.at(-1)).toEqual([items.at(-1)]);
  });
});
