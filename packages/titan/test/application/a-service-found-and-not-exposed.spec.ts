/**
 * A service found and not exposed.
 *
 * Auto-exposure finds a `@Service` class through its provider — a
 * `useClass` under a Symbol token included — and then resolves it BY CLASS.
 * A class registered only under the Symbol is not a token of its own, so it
 * cannot be resolved that way, and it was skipped with «Service instance not
 * found for auto-exposure»: the same sentence as a service that resolved to
 * nothing or threw while building. On the daos dev stand (2026-09-25)
 * `OmnitronStorageSharesPublic` was skipped like this, and a reader of the
 * boot log took the skip for silence.
 *
 * Held here: the line names the class and which of the three it was.
 */
import { describe, expect, it, vi } from 'vitest';

import { Container, createToken } from '../../src/nexus/index.js';
import { Injectable, Service } from '../../src/decorators/index.js';
import { ServiceExposer } from '../../src/application/_internal/service-exposer.js';

@Injectable()
@Service({ name: 'SymbolOnly', version: '1.0.0' })
class SymbolOnly {
  ping(): string {
    return 'pong';
  }
}

@Injectable()
@Service({ name: 'ByClass', version: '1.0.0' })
class ByClass {
  ping(): string {
    return 'pong';
  }
}

const SYMBOL_ONLY = createToken<SymbolOnly>('SymbolOnlyToken');

describe('a service auto-exposure found and did not expose', () => {
  it('says so, with the class and the reason — not «instance not found»', async () => {
    const container = new Container();
    container.register(SYMBOL_ONLY, { useClass: SymbolOnly });
    container.register(ByClass, { useClass: ByClass });

    const lines: Array<{ fields: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: (fields: Record<string, unknown>, msg: string) => lines.push({ fields, msg }),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const exposed: string[] = [];
    const netron = {
      peer: { exposeService: vi.fn(async (instance: object) => void exposed.push(instance.constructor.name)) },
    };

    const count = await new ServiceExposer(container, () => logger as never).expose(netron as never);

    expect(count).toBe(1);
    expect(exposed).toEqual(['ByClass']);
    const skip = lines.find((l) => l.msg.includes('SymbolOnly') && l.msg.includes('not exposed'));
    expect(skip, lines.map((l) => l.msg).join('\n')).toBeDefined();
    expect(skip!.fields).toMatchObject({ serviceName: 'SymbolOnly', className: 'SymbolOnly' });
    expect(String(skip!.fields['because'])).toMatch(/not registered under its own class/);
    expect(lines.some((l) => l.msg === 'Service instance not found for auto-exposure')).toBe(false);
  });
});
