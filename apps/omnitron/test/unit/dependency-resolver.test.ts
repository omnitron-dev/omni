import { describe, it, expect } from 'vitest';
import { resolveStartupOrder, resolveShutdownOrder } from '../../src/orchestrator/dependency-resolver.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';

function entry(name: string, dependsOn?: string[]): IEcosystemAppEntry {
  return { name, bootstrap: `./apps/${name}/src/bootstrap.ts`, dependsOn };
}

describe('DependencyResolver', () => {
  describe('resolveStartupOrder', () => {
    it('returns single batch for apps with no dependencies', () => {
      const apps = [entry('a'), entry('b'), entry('c')];
      const batches = resolveStartupOrder(apps);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(3);
    });

    it('respects linear dependency chain', () => {
      const apps = [entry('c', ['b']), entry('b', ['a']), entry('a')];
      const batches = resolveStartupOrder(apps);
      expect(batches).toHaveLength(3);
      expect(batches[0]!.map((a) => a.name)).toEqual(['a']);
      expect(batches[1]!.map((a) => a.name)).toEqual(['b']);
      expect(batches[2]!.map((a) => a.name)).toEqual(['c']);
    });

    it('allows parallel start of independent apps at same level', () => {
      const apps = [entry('main'), entry('storage', ['main']), entry('paysys', ['main'])];
      const batches = resolveStartupOrder(apps);
      expect(batches).toHaveLength(2);
      expect(batches[0]!.map((a) => a.name)).toEqual(['main']);
      expect(batches[1]!.map((a) => a.name).sort()).toEqual(['paysys', 'storage']);
    });

    it('handles diamond dependency', () => {
      const apps = [entry('a'), entry('b', ['a']), entry('c', ['a']), entry('d', ['b', 'c'])];
      const batches = resolveStartupOrder(apps);
      expect(batches).toHaveLength(3);
      expect(batches[0]!.map((a) => a.name)).toEqual(['a']);
      expect(batches[1]!.map((a) => a.name).sort()).toEqual(['b', 'c']);
      expect(batches[2]!.map((a) => a.name)).toEqual(['d']);
    });

    it('detects circular dependency', () => {
      const apps = [entry('a', ['c']), entry('b', ['a']), entry('c', ['b'])];
      expect(() => resolveStartupOrder(apps)).toThrow('Circular dependency');
    });

    it('detects self-dependency as circular', () => {
      const apps = [entry('a', ['a'])];
      expect(() => resolveStartupOrder(apps)).toThrow('Circular dependency');
    });

    it('throws on unknown dependency', () => {
      const apps = [entry('a', ['nonexistent'])];
      expect(() => resolveStartupOrder(apps)).toThrow("depends on unknown app 'nonexistent'");
    });

    it('handles empty app list', () => {
      expect(resolveStartupOrder([])).toEqual([]);
    });

    it('handles single app with no dependencies', () => {
      const batches = resolveStartupOrder([entry('solo')]);
      expect(batches).toHaveLength(1);
      expect(batches[0]![0]!.name).toBe('solo');
    });

    it('handles complex multi-level DAG', () => {
      const apps = [
        entry('main'),
        entry('storage', ['main']),
        entry('priceverse'),
        entry('paysys', ['main']),
        entry('messaging', ['main', 'storage']),
      ];
      const batches = resolveStartupOrder(apps);

      // main and priceverse have no deps — first batch
      const batch0Names = batches[0]!.map((a) => a.name).sort();
      expect(batch0Names).toEqual(['main', 'priceverse']);

      // storage and paysys depend on main
      const batch1Names = batches[1]!.map((a) => a.name).sort();
      expect(batch1Names).toEqual(['paysys', 'storage']);

      // messaging depends on main + storage
      expect(batches[2]!.map((a) => a.name)).toEqual(['messaging']);
    });
  });

  describe('resolveShutdownOrder', () => {
    it('returns reverse of startup order', () => {
      const apps = [entry('a'), entry('b', ['a']), entry('c', ['b'])];
      const startup = resolveStartupOrder(apps);
      const shutdown = resolveShutdownOrder(apps);

      expect(shutdown).toHaveLength(startup.length);
      expect(shutdown[0]!.map((a) => a.name)).toEqual(['c']);
      expect(shutdown[1]!.map((a) => a.name)).toEqual(['b']);
      expect(shutdown[2]!.map((a) => a.name)).toEqual(['a']);
    });

    it('shuts down dependents before dependencies', () => {
      const apps = [entry('main'), entry('storage', ['main']), entry('messaging', ['main'])];
      const shutdown = resolveShutdownOrder(apps);
      // storage and messaging shut down first (they depend on main)
      const firstBatchNames = shutdown[0]!.map((a) => a.name).sort();
      expect(firstBatchNames).toEqual(['messaging', 'storage']);
      // main shuts down last
      expect(shutdown[1]!.map((a) => a.name)).toEqual(['main']);
    });
  });
});
