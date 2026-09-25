/**
 * A container started with the spec it no longer had.
 *
 * The reconciler compares a container with its desired spec — image, and the
 * spec hash it was labelled with — before it leaves it alone. It asked that
 * only of a RUNNING container. One that was `created` or `exited` got
 * `start`, which runs the spec the container was created with. Nominatim on
 * daos/test was created at 05:37 with a mount the master had not rewritten;
 * after the fix that corrected its desired spec, every reconcile «started»
 * the old container again — «exec: /opt/nominatim-tools/cis-entrypoint.sh:
 * no such file or directory» — and it never came up (2026-09-25).
 *
 * Held here: a stopped container whose image or spec drifted is recreated;
 * one that matches is started; a running one is judged as before.
 */
import { describe, expect, it, vi } from 'vitest';

import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import type { ContainerState, ResolvedContainer } from '../../src/infrastructure/types.js';

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => quiet() }) as never;

const desired = {
  name: 'daos-test-nominatim',
  image: 'mediagis/nominatim:4.4',
  ports: [],
  environment: {},
  volumes: [{ source: '/root/.omnitron/stack-config/daos/test/nominatim', target: '/opt/nominatim-tools', readonly: true }],
} as unknown as ResolvedContainer;

const action = (actual: Partial<ContainerState> | null) => {
  const svc = new InfrastructureService(quiet(), {} as never, {} as never, undefined, undefined, false);
  return (svc as unknown as { computeAction(d: ResolvedContainer, a: ContainerState | null): { type: string; reason?: string } }).computeAction(
    desired,
    actual as ContainerState | null,
  );
};

const created = (over: Partial<ContainerState> = {}) =>
  ({ name: desired.name, image: desired.image, status: 'created', containerId: '9bab30bb46ff', ...over }) as Partial<ContainerState>;

describe('a container that is not running', () => {
  it('created with a spec the service no longer has — recreated, not started', () => {
    const a = action(created({ specHash: '00f71e17fd206a95' }));
    expect(a.type).toBe('recreate');
    expect(a.reason).toMatch(/config drift while created \(spec 00f71e17fd206a95 → /);
  });

  it('exited under an image the service no longer runs — recreated', () => {
    const a = action(created({ status: 'exited', image: 'mediagis/nominatim:4.2', specHash: containerSpecHash(desired) }));
    expect(a.type).toBe('recreate');
    expect(a.reason).toMatch(/image changed while stopped/);
  });

  it('matching what is desired — started', () => {
    expect(action(created({ specHash: containerSpecHash(desired) })).type).toBe('start');
  });

  it('with no spec label — started, as an older container always was', () => {
    expect(action(created()).type).toBe('start');
  });
});

describe('a running container', () => {
  it('is judged as before: drift recreates, a match is left alone', () => {
    expect(action(created({ status: 'running', specHash: 'stale' })).type).toBe('recreate');
    expect(action(created({ status: 'running', specHash: containerSpecHash(desired) })).type).toBe('noop');
  });
});

describe('no container at all', () => {
  it('is created', () => {
    expect(action(null).type).toBe('create');
  });
});
