import { describe, it, expect } from 'vitest';
import { LumenMacroRegistry } from '@omnitron-dev/lumen-ast';

describe('Feature 7: Shared KaTeX Macro Registry Boundaries', () => {
  it('TC-B07-01: prevents infinite recursion during circular macro registration and retrieval', () => {
    const registry = new LumenMacroRegistry({
      '\\alpha': '\\beta',
      '\\beta': '\\gamma',
      '\\gamma': '\\alpha',
    });

    expect(registry.size()).toBe(3);
    const macros = registry.getMacros();
    expect(macros['\\alpha']).toBe('\\beta');
    expect(macros['\\beta']).toBe('\\gamma');
    expect(macros['\\gamma']).toBe('\\alpha');

    // Recursive expansion resolution cycle detector guard
    function resolveChain(start: string, maxDepth: number = 10): string[] {
      const visited = [start];
      let current = start;
      while (registry.has(current) && visited.length <= maxDepth) {
        current = registry.getMacros()[current]!;
        if (visited.includes(current)) {
          visited.push(current);
          break; // Cycle detected and halted safely
        }
        visited.push(current);
      }
      return visited;
    }

    const chain = resolveChain('\\alpha');
    expect(chain[chain.length - 1]).toBe(chain[0]);
    expect(chain.length).toBeLessThanOrEqual(5);
  });

  it('TC-B07-02: handles empty, numerical, or malformed macro keys cleanly', () => {
    const registry = new LumenMacroRegistry();

    // Empty key registration
    registry.register({ '': '\\emptyset' });
    expect(registry.has('')).toBe(true);

    // Non-standard macro names
    registry.register({ '\\123': '\\text{numeric}', '\\ ': '\\quad' });
    expect(registry.has('\\123')).toBe(true);
    expect(registry.has('\\ ')).toBe(true);
  });

  it('TC-B07-03: tracks overrides of core mathematical primitives without registry corruption', () => {
    const registry = new LumenMacroRegistry();

    // Overriding standard KaTeX primitives
    registry.register({
      '\\frac': '\\dfrac',
      '\\sum': '\\sum\\limits',
    });

    expect(registry.has('\\frac')).toBe(true);
    expect(registry.getMacros()['\\frac']).toBe('\\dfrac');
    expect(registry.getMacros()['\\sum']).toBe('\\sum\\limits');
  });

  it('TC-B07-04: preserves non-ASCII and Unicode characters in macro definitions without distortion', () => {
    const unicodeMacros: Record<string, string> = {
      '\\field': 'ℝ',
      '\\complex': 'ℂ',
      '\\psiState': 'Ψ',
      '\\tensorProd': '⊗',
      '\\cyrillic': 'Оператор',
      '\\emoji': '✨',
    };

    const registry = new LumenMacroRegistry(unicodeMacros);

    for (const [key, val] of Object.entries(unicodeMacros)) {
      expect(registry.has(key)).toBe(true);
      expect(registry.getMacros()[key]).toBe(val);
    }
  });

  it('TC-B07-05: handles massive scale registration of 1,000 macros with sub-millisecond lookups', () => {
    const registry = new LumenMacroRegistry();
    const count = 1_000;
    const bulkMacros: Record<string, string> = {};

    for (let i = 0; i < count; i++) {
      bulkMacros[`\\macro${i}`] = `\\mathcal{M}_{${i}}`;
    }

    const startReg = Date.now();
    registry.register(bulkMacros);
    const regDuration = Date.now() - startReg;

    expect(registry.size()).toBe(count);
    expect(regDuration).toBeLessThan(50);

    // Fast O(1) random key lookup
    const startLookup = performance.now();
    for (let i = 0; i < 100; i++) {
      const idx = Math.floor(Math.random() * count);
      expect(registry.has(`\\macro${idx}`)).toBe(true);
    }
    const lookupDuration = performance.now() - startLookup;
    expect(lookupDuration).toBeLessThan(10);
  });
});
