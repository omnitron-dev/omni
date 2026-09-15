/**
 * A config said the gateway listens on 8080, and it listens on 80.
 *
 * A preset's `defaultPorts` and a stack's `ports` were merged as one thing,
 * so writing `ports: { http: 8080 }` for the openresty gateway declared that
 * its nginx listens on 8080. It listens on 80 — that is a fact about the
 * image, not something a config can change — so the container published
 * 8080→8080 while the server was on 80, and every connection to it was
 * refused:
 *
 *     wget: can't connect to remote host: Connection refused
 *
 * measured inside the container, on a gateway that was at that moment
 * serving an onion address correctly through the docker network.
 *
 * The distinction is right for the others and was accidentally harmless
 * there: nobody changes the port Postgres listens on by editing a stack
 * config — they change the one it is published at.
 */

import { describe, it, expect } from 'vitest';

import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';

const expand = (preset: string, ports?: Record<string, number>, docker?: Record<string, unknown>) =>
  createDefaultRegistry().expand(preset, {
    preset,
    ...(ports ? { ports } : {}),
    ...(docker ? { docker } : {}),
  } as never);

describe('which port is the container s and which is the host s', () => {
  it('keeps the image s own port as the container port', () => {
    const gateway = expand('openresty', { http: 8080 });

    // nginx listens on 80 in this image whatever the config says.
    expect(gateway.ports).toEqual({ http: 80 });
    // And 8080 is where it is published.
    expect(gateway.docker?.portMappings).toEqual({ http: 8080 });
  });

  it('does the same for a database, where it was accidentally harmless', () => {
    const postgres = expand('postgres', { main: 15432 });

    // Nobody changes the port Postgres listens on by editing a stack config.
    expect(postgres.ports).toEqual({ main: 5432 });
    expect(postgres.docker?.portMappings).toEqual({ main: 15432 });
  });

  it('leaves a preset alone when the config names no port', () => {
    const redis = expand('redis');

    expect(redis.ports).toEqual({ main: 6379 });
    expect(redis.docker?.portMappings).toBeUndefined();
  });

  it('lets an explicit portMappings entry win', () => {
    const postgres = expand('postgres', { main: 15432 }, { portMappings: { main: 25432 } });

    // It says the same thing more precisely, so it is not overridden by the
    // shorthand.
    expect(postgres.docker?.portMappings).toEqual({ main: 25432 });
    expect(postgres.ports).toEqual({ main: 5432 });
  });

  it('treats a port the preset never declared as a container port', () => {
    const minio = expand('minio', { metrics: 9100 });

    // The config is describing something the preset does not know about, so
    // there is no image fact to preserve and the config is the only source.
    expect(minio.ports?.['metrics']).toBe(9100);
    expect(minio.ports?.['api']).toBe(9000);
  });
});
