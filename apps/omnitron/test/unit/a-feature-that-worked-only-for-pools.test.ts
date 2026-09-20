/**
 * `topology.expose` was implemented for pools and ignored in silence for
 * everything else.
 *
 * `launchTopology` splits the declared processes in two — `instances > 1` is
 * a pool, everything else is a supervisor child — and only the pool branch
 * ever read `topology.expose`. A single process declaring it got no
 * registration on the daemon and no message about it, and every consumer
 * naming it in `topology.access` started without a proxy and said nothing
 * either.
 *
 * Measured on priceverse. Its `collector` is a single process and holds the
 * only objects that know whether the exchange WebSockets are up; the server
 * process runs the health service. So readiness answered
 *
 *     Service not ready: exchanges unavailable
 *
 * for the life of every server process, while the collector logged three
 * `WebSocket connected` in the same minute. The comment in the orchestrator
 * said it outright — "Currently only pool processes support topology.expose"
 * — and nothing downstream knew.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const orchestrator = stripComments(
  fs.readFileSync(path.join(here, '../../src/orchestrator/orchestrator.service.ts'), 'utf8'),
);
const router = stripComments(
  fs.readFileSync(path.join(here, '../../src/orchestrator/service-router.ts'), 'utf8'),
);

describe('a single process can expose a service', () => {
  it('registers the ones that ask for it', () => {
    expect(orchestrator).toContain('exposeChildTopologyServices(');
    expect(orchestrator).toMatch(/procEntry\.topology\?\.expose !== true\) continue/);
  });

  it('asks after the supervisor has started, because there is no child before it', () => {
    const at = orchestrator.indexOf('await this.exposeChildTopologyServices(');
    const start = orchestrator.lastIndexOf('await supervisor.start();', at);

    expect(start).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(start);
  });

  it('polls, because a child reports ready before its services exist', () => {
    // The pool path learned this the hard way: asking once asks a process
    // that is still booting, and an empty list disabled the feature for the
    // life of the consumer.
    const at = orchestrator.indexOf('private async exposeChildTopologyServices(');
    const body = orchestrator.slice(at, orchestrator.indexOf('\n  }\n', at));

    expect(body).toContain('TOPOLOGY_EXPOSE_TIMEOUT_MS');
    expect(body).toContain('TOPOLOGY_EXPOSE_POLL_MS');
    expect(body).toMatch(/while \(!usable\(services\)/);
  });

  it('says so when it finds nothing to register', () => {
    const at = orchestrator.indexOf('private async exposeChildTopologyServices(');
    const body = orchestrator.slice(at, orchestrator.indexOf('\n  }\n', at));

    expect(body).toMatch(/topology\.expose has no effect/);
    expect(body).toMatch(/exposes no methods/);
  });
});

describe('the proxy asks the child that is running now', () => {
  it('looks the child up per call, because a restart replaces it', () => {
    const at = router.indexOf('private createChildProxy(');
    expect(at, 'createChildProxy is where this test thinks it is').toBeGreaterThan(-1);
    const body = router.slice(at, router.indexOf('\n  }', router.indexOf('return new DynamicRouterService', at)));

    expect(body).toMatch(/const child = getProxy\(\);/);
    // Not captured once into a variable outside the method bodies.
    expect(body).not.toMatch(/const proxy = getProxy\(\);[\s\S]*for \(const method/);
  });

  it('goes through the same callExposedService hop as a pool', () => {
    // A direct call asks `BootstrapApp` — the wrapper — for a method it has
    // never had, and the caller gets "Unknown member" naming a service it
    // did not call.
    expect(router).toMatch(/child\.callExposedService\(serviceName, method, args\)/);
  });

  it('answers a call into a dead process with a sentence', () => {
    const at = router.indexOf('private createChildProxy(');
    const body = router.slice(at, at + 1800);

    expect(body).toMatch(/is not running/);
  });

  it('builds the metadata Netron indexes, like the pool proxy', () => {
    const at = router.indexOf('private createChildProxy(');
    const body = router.slice(at, router.indexOf('\n  }', router.indexOf('return new DynamicRouterService', at)));

    // Plain objects, not Maps — `Interface` resolves through
    // `$def.meta.methods[prop]`, and a Map indexes to undefined for every
    // name.
    expect(body).toMatch(/methods: \{\} as Record<string, \{ type: string; arguments: unknown\[\] \}>/);
    expect(body).toMatch(/metadata\.methods\[method\] = \{ type: 'Promise', arguments: \[\] \}/);
    expect(body).toMatch(/Reflect\.defineMetadata\(SERVICE_ANNOTATION/);
  });
});
