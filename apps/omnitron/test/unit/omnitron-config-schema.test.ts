/**
 * The exported zod schema and the type the daemon reads must describe the
 * same config.
 *
 * `OmnitronAppConfig` is what the daemon consumes out of an app's
 * `config/default.json`. `createOmnitronConfigSchema` is what apps validate
 * that section with, and it is exported from `@omnitron-dev/omnitron/config`
 * — a public surface. Nothing joined the two, and the schema had fallen two
 * keys behind: `infrastructure` and `services.priceverse`.
 *
 * The consequence was not symmetrical, which is why it survived. The daemon
 * reads the file raw, so it saw both keys and worked. An app validating its
 * own config got them stripped — a zod object drops what it does not
 * declare — and an app validating strictly was told a correct config was
 * wrong. paysys declares both.
 *
 * The schema factory takes `z` as a parameter, so its shape can be read by
 * handing it a recorder instead of zod. That is the whole trick here: the
 * assertion is against what the factory builds, not against a copy of it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOmnitronConfigSchema } from '../../src/config/omnitron-config.schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = path.resolve(here, '../../src/config/types.ts');

/** A stand-in for `z` that records the object shapes the factory builds. */
function recordingZod(): { z: any; shapes: Array<Record<string, unknown>> } {
  const shapes: Array<Record<string, unknown>> = [];
  const node = (): any => ({
    optional: () => node(),
    nullable: () => node(),
  });
  const z: any = {
    object: (shape: Record<string, unknown>) => {
      shapes.push(shape);
      return node();
    },
    union: () => node(),
    boolean: () => node(),
    string: () => node(),
    number: () => node(),
    any: () => node(),
    array: () => node(),
    enum: () => node(),
    record: () => node(),
  };
  return { z, shapes };
}

/** Top-level property names declared on an interface in `types.ts`. */
function interfaceKeys(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start === -1) return [];
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(start, end);
  // Two-space indentation is the top level of the interface; anything deeper
  // is a nested object literal.
  return Array.from(body.matchAll(/^ {2}(\w+)\??\s*:/gm), (m) => m[1]!);
}

describe('omnitron app config schema', () => {
  const { z, shapes } = recordingZod();
  createOmnitronConfigSchema(z);
  const typeSource = fs.readFileSync(TYPES, 'utf8');

  // Shapes arrive in evaluation order, so the nested ones are recorded
  // first and the top level last. Identifying it by position was wrong on
  // the first attempt — `shapes[0]` is `{min, max}` from the pool — so it is
  // identified by content instead, which survives adding a nested object.
  const topLevel = shapes.find((shape) => 'database' in shape && 'redis' in shape);

  it('recorded the shapes the factory builds', () => {
    // Before comparing anything: a recorder that captured nothing would make
    // every set comparison below trivially true.
    expect(shapes.length, 'object shapes built by the factory').toBeGreaterThanOrEqual(4);
    expect(topLevel, 'the top-level schema shape').toBeDefined();
  });

  it('declares every key the daemon reads from the config file', () => {
    const schemaKeys = new Set(Object.keys(topLevel!));
    const typeKeys = interfaceKeys(typeSource, 'OmnitronAppConfig');

    expect(typeKeys.length, 'keys parsed from OmnitronAppConfig').toBeGreaterThanOrEqual(5);
    expect(
      typeKeys.filter((k) => !schemaKeys.has(k)),
      'declared on OmnitronAppConfig, absent from the schema — zod strips these'
    ).toEqual([]);
  });

  it('declares nothing the daemon does not read', () => {
    // The other direction. A schema key with no counterpart is a promise to
    // app authors that the daemon does not keep.
    const typeKeys = new Set(interfaceKeys(typeSource, 'OmnitronAppConfig'));
    const extra = Object.keys(topLevel!).filter((k) => !typeKeys.has(k));

    expect(extra, 'in the schema, not in OmnitronAppConfig').toEqual([]);
  });

  it('covers the cross-app service flags the daemon acts on', () => {
    // `services.priceverse` was the one that was missing, and the daemon
    // reads it to grant a second app's Redis. Named explicitly because a
    // nested shape is easy to leave behind when the top level is checked.
    const services = shapes.find((s) => 'discovery' in s);
    expect(services, 'services shape').toBeDefined();
    expect(Object.keys(services!).sort()).toEqual(['discovery', 'notifications', 'priceverse']);
  });
});
