/**
 * Automatic and Explicit Theorem Numbering Engine
 */

import type { MathEnvType, MathEnvironmentAttributes } from './environments.js';

export class MathNumberingEngine {
  private counters: Map<MathEnvType, number> = new Map();
  private assignedNumbers: Map<string, string> = new Map();

  reset(): void {
    this.counters.clear();
    this.assignedNumbers.clear();
  }

  assignNumber(envType: MathEnvType, attrs: MathEnvironmentAttributes): string | undefined {
    if (attrs.number) {
      if (attrs.id) this.assignedNumbers.set(attrs.id, attrs.number);
      return attrs.number;
    }

    if (attrs.unnumbered || envType === 'proof' || envType === 'remark') {
      return undefined;
    }

    const current = (this.counters.get(envType) ?? 0) + 1;
    this.counters.set(envType, current);
    const resolved = String(current);
    if (attrs.id) this.assignedNumbers.set(attrs.id, resolved);
    return resolved;
  }

  getNumberForId(id: string): string | undefined {
    return this.assignedNumbers.get(id);
  }
}
