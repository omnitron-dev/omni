/**
 * What a bad module input says.
 *
 * Both failures here are boot-blocking and used to be reported as
 * "Failed to create module instance from provided input" — a sentence that
 * names neither the module, the import, nor the shape that was wrong. On an
 * application with forty modules that is a boot that dies and nothing to act
 * on, which is how one of these cost an evening.
 *
 * The `undefined` case in particular is never a typo. `@Module({ imports:
 * [Other] })` evaluates its argument when the class is DEFINED, so a circular
 * ESM import captures `undefined` in the array — and the module that captured
 * it is usually NOT the one the author just edited, because adding one edge is
 * what made an existing chain circular.
 */
import { describe, it, expect } from 'vitest';

import { Application } from '../../src/application.js';
import { Module } from '../../src/decorators/index.js';
import { createToken } from '../../src/nexus/index.js';

const TOKEN = createToken<{ v(): string }>('InputErrorToken');

@Module({
  imports: [undefined] as never,
  providers: [[TOKEN, { useFactory: () => ({ v: () => 'x' }) }]],
})
class ModuleWithUndefinedImport {}

@Module({
  imports: [() => undefined] as never,
  providers: [[TOKEN, { useFactory: () => ({ v: () => 'x' }) }]],
})
class ModuleWithEmptyForwardRef {}

describe('module input errors', () => {
  it('names the module holding an undefined import and the position', async () => {
    const failure = await Application.create({
      imports: [ModuleWithUndefinedImport],
      disableGracefulShutdown: true,
    }).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    );

    expect(failure, 'an undefined import was accepted').not.toBe(null);
    expect(failure).toContain('ModuleWithUndefinedImport');
    expect(failure).toContain('imports[0]');
    expect(failure).toMatch(/forwardRef/);
  });

  it('explains a forwardRef that resolved to nothing', async () => {
    const failure = await Application.create({
      imports: [ModuleWithEmptyForwardRef],
      disableGracefulShutdown: true,
    }).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    );

    expect(failure, 'a thunk returning undefined was accepted').not.toBe(null);
    expect(failure).toMatch(/forwardRef/);
    expect(failure, 'the reader is not told a circular import is the usual cause').toMatch(
      /circular ESM import/
    );
  });
});
