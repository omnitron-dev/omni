/**
 * The node threw away the credentials it had been handed, one line later.
 *
 * A stack app's environment is assembled from three sources, and the order
 * they are spread in decides which one an app actually runs with:
 *
 *     env: { ...entry.env, ...infraEnv, ...stackConfig.settings?.env, … }
 *
 * `infraEnv` is COMPUTED — `resolvedConfigToEnv` over what `resolveStack`
 * made of the stack's configuration. `entry.env` is WRITTEN: by a developer
 * in the project config, or, on a node, by the master that provisioned the
 * services and read their credentials back from the machine they run on.
 *
 * Computed won. On a master that is harmless, because the computation has
 * the whole configuration to work from. On a NODE it has nothing: the
 * generated config carries no `infrastructure` block — deliberately, because
 * a block is an instruction to provision — so `resolveStackAddresses` ends at
 *
 *     infra?.postgres?.password ?? getEnv().POSTGRES_PASSWORD ?? 'postgres'
 *
 * and a correct `postgres://postgres:<43-char generated secret>@…` was
 * overwritten with `postgres://postgres:postgres@…` between being written
 * into the config and being handed to the process. Measured, after the
 * config on disk was verified correct and the credentials in it were
 * verified to work from that very host against both databases:
 *
 *     password authentication failed for user "postgres" (28P01)
 *
 * The other half of the same order: an operator could not override a
 * computed address at all, which is not something a config system should
 * refuse.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = stripComments(fs.readFileSync(path.join(here, '../../src/services/project.service.ts'), 'utf8'));

/**
 * The spread order as the source declares it.
 *
 * Read from the file rather than exercised through `startLocalStack`, which
 * needs a registry, an orchestrator, a docker daemon and a socket to reach
 * four lines. The order IS the behaviour here, and it is visible.
 */
function spreadOrder(): string[] {
  const at = source.indexOf('OMNITRON_STACK_TYPE');
  expect(at, 'the env assembly is where this test thinks it is').toBeGreaterThan(-1);
  const open = source.lastIndexOf('env: {', at);
  const block = source.slice(open, at);
  return [...block.matchAll(/\.\.\.([A-Za-z.?\]['\w]+)/g)].map((m) => m[1]!);
}

describe('stated beats computed', () => {
  it('spreads the computed environment before the stated one', () => {
    const order = spreadOrder();
    const infra = order.findIndex((k) => k.includes('infraEnv'));
    const entry = order.findIndex((k) => k.includes('entry.env'));

    expect(infra, 'infraEnv is in the spread').toBeGreaterThan(-1);
    expect(entry, 'entry.env is in the spread').toBeGreaterThan(-1);
    // Later wins in an object spread. This is the whole assertion.
    expect(infra).toBeLessThan(entry);
  });

  it('still lets the stack settings win over both', () => {
    const order = spreadOrder();
    // `settings.env` and `settings.appEnv[app]`, resolved from the vault
    // before the builder runs, arrive as `stackEnv[entry.name]`
    // (a-secret-a-stack-could-not-give-one-app).
    const settings = order.findIndex((k) => k.includes('stackEnv'));
    expect(settings, 'the stack env is in the spread').toBeGreaterThan(-1);

    expect(settings).toBeGreaterThan(order.findIndex((k) => k.includes('infraEnv')));
    expect(settings).toBeGreaterThan(order.findIndex((k) => k.includes('entry.env')));
  });

  it('keeps the identifying variables last, where nothing can shadow them', () => {
    // `OMNITRON_PROJECT` / `OMNITRON_STACK` say which deployment a process
    // belongs to. An app that could set them from its own env could lie
    // about that to everything reading them.
    const at = source.indexOf('OMNITRON_STACK_TYPE');
    const open = source.lastIndexOf('env: {', at);
    const block = source.slice(open, at);

    expect(block.lastIndexOf('...')).toBeLessThan(block.indexOf('OMNITRON_PROJECT'));
  });
});

describe('the precedence in one object, spelled out', () => {
  // The rule under test, as three lines anyone can check by eye.
  const assemble = (
    infraEnv: Record<string, string>,
    entryEnv: Record<string, string>,
    settings: Record<string, string>,
  ) => ({ ...infraEnv, ...entryEnv, ...settings });

  it('gives the master\'s resolved credential to the app', () => {
    const out = assemble(
      { DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/geo' },
      { DATABASE_URL: 'postgres://postgres:GENERATED@localhost:5432/geo' },
      {},
    );

    expect(out.DATABASE_URL).toBe('postgres://postgres:GENERATED@localhost:5432/geo');
  });

  it('keeps the computed value when nothing states one', () => {
    const out = assemble({ DATABASE_URL: 'postgres://u:p@localhost:5432/geo', REDIS_URL: 'redis://localhost:6379/5' }, {}, {});

    expect(out.DATABASE_URL).toBe('postgres://u:p@localhost:5432/geo');
    expect(out.REDIS_URL).toBe('redis://localhost:6379/5');
  });

  it('lets a stack override both', () => {
    const out = assemble(
      { DATABASE_URL: 'computed' },
      { DATABASE_URL: 'stated' },
      { DATABASE_URL: 'the stack says so' },
    );

    expect(out.DATABASE_URL).toBe('the stack says so');
  });
});
