/**
 * Unified KaTeX Macro Registry ensuring mathematical macro consistency
 * across document body, headers, and Table of Contents (ToC).
 */

export class LumenMacroRegistry {
  private readonly macros = new Map<string, string>();

  constructor(initial?: Record<string, string> | Map<string, string> | LumenMacroRegistry) {
    if (initial instanceof LumenMacroRegistry) {
      this.register(initial.getMacros());
    } else if (initial instanceof Map) {
      for (const [key, val] of initial.entries()) {
        this.macros.set(key, val);
      }
    } else if (initial && typeof initial === 'object') {
      this.register(initial);
    }
  }

  register(macros: Record<string, string>): void {
    for (const [key, val] of Object.entries(macros)) {
      this.macros.set(key, val);
    }
  }

  getMacros(): Record<string, string> {
    return Object.fromEntries(this.macros.entries());
  }

  toRecord(): Record<string, string> {
    return this.getMacros();
  }

  has(key: string): boolean {
    return this.macros.has(key);
  }

  size(): number {
    return this.macros.size;
  }

  clear(): void {
    this.macros.clear();
  }

  clone(): LumenMacroRegistry {
    return new LumenMacroRegistry(this.getMacros());
  }
}
