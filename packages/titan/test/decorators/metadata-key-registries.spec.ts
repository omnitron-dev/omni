/**
 * One metadata key per thing.
 *
 * `decorators/constants.ts` exports DECORATOR_METADATA as part of this
 * package's public surface, and it used to declare its own values. All
 * twenty-one names it shares with core.ts's METADATA_KEYS disagreed with it —
 * every single one, INJECTABLE and MODULE and SCOPE and METHOD_AUTH included.
 * The decorators write through METADATA_KEYS, so anything reading metadata via
 * DECORATOR_METADATA found nothing, for every key, with no error anywhere.
 *
 * Two registries for one thing, both looking canonical. This checks they
 * cannot drift again, and that the keys the decorators write are the keys a
 * reader gets.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { METADATA_KEYS, Injectable, Module, Service } from '../../src/decorators/index.js';
import { DECORATOR_METADATA } from '../../src/decorators/constants.js';

describe('metadata key registries', () => {
  it('agree on every name they share', () => {
    const shared = Object.keys(METADATA_KEYS).filter((k) => k in DECORATOR_METADATA);

    // Without this the comparison passes by finding nothing to compare.
    expect(shared.length, 'the registries no longer share any names').toBeGreaterThan(15);

    const conflicts = shared
      .filter(
        (k) =>
          (METADATA_KEYS as Record<string, string>)[k] !== (DECORATOR_METADATA as Record<string, string>)[k]
      )
      .map(
        (k) =>
          `${k}: core '${(METADATA_KEYS as Record<string, string>)[k]}' vs constants '${(DECORATOR_METADATA as Record<string, string>)[k]}'`
      );

    expect(conflicts, `a reader using DECORATOR_METADATA would find nothing for:\n${conflicts.join('\n')}`).toEqual(
      []
    );
  });

  it('a decorator writes where the exported key points', () => {
    // The reason the divergence mattered: the key is the only thing joining
    // the decorator to whatever reads it.
    @Injectable()
    @Service('probe@1.0.0')
    class Probe {}

    expect(
      Reflect.getMetadata(DECORATOR_METADATA.INJECTABLE, Probe),
      'DECORATOR_METADATA.INJECTABLE does not find what @Injectable wrote'
    ).toBeDefined();

    expect(
      Reflect.getMetadata(DECORATOR_METADATA.SERVICE_ANNOTATION, Probe),
      'DECORATOR_METADATA.SERVICE_ANNOTATION does not find what @Service wrote'
    ).toBeDefined();

    @Module({})
    class ProbeModule {}

    expect(
      Reflect.getMetadata(DECORATOR_METADATA.MODULE, ProbeModule),
      'DECORATOR_METADATA.MODULE does not find what @Module wrote'
    ).toBeDefined();
  });
});
