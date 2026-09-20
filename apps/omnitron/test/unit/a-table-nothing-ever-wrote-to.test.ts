/**
 * A console with accounts, roles and sessions could not say who did anything.
 *
 * `omnitron_audit_log` has been in the schema since the first migration —
 * `action`, `actorId`, `actorType`, `resourceType`, `resourceId`, `details`,
 * `ipAddress`, and four indexes to read it by — and nothing in this
 * repository has ever written a row to it. `doctor` checks the table exists;
 * that is the only code that names it.
 *
 * So: who stopped the stack, who took the database password out of the
 * vault, who removed the node — the only account was a log line that
 * rotates, and after this session's restarts, one that was gone.
 *
 * What this pins is the part that is easy to get wrong in a hurry: the
 * actor is what the request PROVED, `details` never carries a credential,
 * and a write that fails does not fail the action that was already taken.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuditService, scrubDetails, MAX_AUDIT_PAGE } from '../../src/services/audit.service.js';
import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceOf = (file: string) =>
  stripComments(fs.readFileSync(path.join(here, '../../src/services', file), 'utf8'));

const logger = (() => {
  const errors: Array<Record<string, unknown>> = [];
  const l: Record<string, unknown> = {
    info() {}, debug() {}, trace() {}, fatal() {}, warn() {},
    error(o: Record<string, unknown>) { errors.push(o); },
    child() { return l; },
  };
  return { l, errors };
})();

/** A Kysely stand-in that remembers what it was asked to insert. */
function fakeDb() {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    inserted,
    insertInto() {
      return {
        values(v: Record<string, unknown>) {
          inserted.push(v);
          return { async execute() {} };
        },
      };
    },
  } as never;
}

describe('a credential never reaches the audit trail', () => {
  it('redacts anything whose key names one', () => {
    const out = scrubDetails({
      host: '10.0.0.1',
      sshPassword: 'hunter2',
      rpc_password: 'x',
      apiKey: 'k',
      privateKey: 'p',
      token: 't',
      passphrase: 'q',
    })!;

    expect(out['host']).toBe('10.0.0.1');
    for (const key of ['sshPassword', 'rpc_password', 'apiKey', 'privateKey', 'token', 'passphrase']) {
      expect(out[key], key).toBe('[redacted]');
    }
  });

  it('does not let a nested object smuggle one in', () => {
    // One level of facts. A payload belongs in a log, not in a table that
    // outlives every rotation.
    const out = scrubDetails({ node: { sshPassword: 'hunter2' }, count: 3 })!;

    expect(out['node']).toBe('[object]');
    expect(out['count']).toBe(3);
  });

  it('keeps an array as it was — a list of names is a fact', () => {
    expect(scrubDetails({ apps: ['main', 'geo'] })!['apps']).toEqual(['main', 'geo']);
  });

  it('answers null for nothing at all', () => {
    expect(scrubDetails(null)).toBeNull();
    expect(scrubDetails(undefined)).toBeNull();
  });
});

describe('an action that could not be recorded is not a failed action', () => {
  it('does not throw when the insert does', async () => {
    logger.errors.length = 0;
    const db = {
      insertInto() {
        return { values() { return { async execute() { throw new Error('connection refused'); } } } };
      },
    } as never;

    await expect(new AuditService(logger.l as never, db).record({ action: 'stack.stop', resourceType: 'stack' }))
      .resolves.toBeUndefined();

    const said = logger.errors.find((e) => e['action'] === 'stack.stop');
    expect(said, 'the failure is reported').toBeTruthy();
    expect(said!['error']).toBe('connection refused');
  });

  it('records nothing and says nothing on a daemon with no database', async () => {
    logger.errors.length = 0;
    const svc = new AuditService(logger.l as never, null);

    await svc.record({ action: 'stack.start', resourceType: 'stack' });

    expect(svc.available).toBe(false);
    expect(logger.errors).toEqual([]);
    expect(await svc.list()).toEqual([]);
  });
});

describe('the row says what the request proved', () => {
  it('is `system` when no auth context carried a user', async () => {
    // A boot-time autostart is the daemon acting on its own behalf, and
    // inventing a user for it would make every row suspect.
    const db = fakeDb() as unknown as { inserted: Array<Record<string, unknown>> };
    await new AuditService(logger.l as never, db as never).record({
      action: 'stack.start',
      resourceType: 'stack',
      resourceId: 'daos/test',
    });

    expect(db.inserted[0]!['actorType']).toBe('system');
    expect(db.inserted[0]!['actorId']).toBeNull();
    expect(db.inserted[0]!['resourceId']).toBe('daos/test');
  });

  it('scrubs the details on the way in, not on the way out', async () => {
    const db = fakeDb() as unknown as { inserted: Array<Record<string, unknown>> };
    await new AuditService(logger.l as never, db as never).record({
      action: 'node.add',
      resourceType: 'node',
      details: { host: '10.0.0.1', sshPassword: 'hunter2' },
    });

    expect(db.inserted[0]!['details']).toEqual({ host: '10.0.0.1', sshPassword: '[redacted]' });
  });
});

describe('a page size is the cost of the request', () => {
  it('caps what one call may ask for', () => {
    expect(MAX_AUDIT_PAGE).toBeLessThanOrEqual(500);
  });

  it('clamps a caller that asks for more', async () => {
    let asked = 0;
    const db = {
      selectFrom() {
        const q: Record<string, unknown> = {
          selectAll: () => q,
          orderBy: () => q,
          where: () => q,
          limit: (n: number) => { asked = n; return q; },
          execute: async () => [],
        };
        return q;
      },
    } as never;

    await new AuditService(logger.l as never, db).list({ limit: 100_000 });
    expect(asked).toBe(MAX_AUDIT_PAGE);

    await new AuditService(logger.l as never, db).list({ limit: 0 });
    expect(asked, 'and one that asks for none').toBe(1);
  });
});

describe('the actions worth recording are recorded', () => {
  /** Every method between `async <name>(` and the next `@Public(`. */
  function bodyOf(source: string, method: string): string {
    const at = source.indexOf(`async ${method}(`);
    expect(at, `${method} is declared`).toBeGreaterThan(-1);
    const next = source.indexOf('@Public(', at);
    return source.slice(at, next === -1 ? source.length : next);
  }

  it('records what is done to a stack or a project', () => {
    const src = sourceOf('project.rpc-service.ts');
    for (const [method, action] of [
      ['startStack', 'stack.start'],
      ['stopStack', 'stack.stop'],
      ['addProject', 'project.add'],
      ['removeProject', 'project.remove'],
    ] as const) {
      expect(bodyOf(src, method), method).toContain(`action: '${action}'`);
    }
  });

  it('records what is done to a node', () => {
    const src = sourceOf('node-manager.rpc-service.ts');
    for (const [method, action] of [
      ['addNode', 'node.add'],
      ['updateNode', 'node.update'],
      ['removeNode', 'node.remove'],
    ] as const) {
      expect(bodyOf(src, method), method).toContain(`action: '${action}'`);
    }
  });

  it('records a vault READ, not only its writes', () => {
    // A value that leaves the vault can be used anywhere, and the only
    // account of who took it is this row.
    const src = sourceOf('secrets.rpc-service.ts');
    expect(bodyOf(src, 'get')).toContain("action: 'secret.read'");
    expect(bodyOf(src, 'set')).toContain("action: 'secret.set'");
    expect(bodyOf(src, 'delete')).toContain("action: 'secret.delete'");
  });

  it('never passes the value of a secret to the recorder', () => {
    const src = sourceOf('secrets.rpc-service.ts');
    expect(bodyOf(src, 'set')).not.toMatch(/details:[^}]*data\.value/);
  });

  it('records after the action, so a refused one leaves no row', () => {
    // `addNode` can throw — a duplicate address is refused — and a trail
    // that logs the attempt reads as if it happened.
    const src = sourceOf('node-manager.rpc-service.ts');
    const body = bodyOf(src, 'addNode');

    expect(body.indexOf('await this.nodeManager.addNode(')).toBeLessThan(body.indexOf('this.audit?.record('));
  });

  it('does not make the audit trail a dependency of the control plane', () => {
    // Optional on every constructor: a daemon without the omnitron database
    // still serves these methods.
    for (const file of ['project.rpc-service.ts', 'node-manager.rpc-service.ts', 'secrets.rpc-service.ts']) {
      expect(sourceOf(file), file).toMatch(/audit\?: import\('\.\/audit\.service\.js'\)\.AuditService \| undefined/);
      expect(sourceOf(file), file).toContain('this.audit?.record(');
    }
  });
});
