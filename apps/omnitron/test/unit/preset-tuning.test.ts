/**
 * The tuning block in a service config reaches the container.
 *
 * `PostgresServiceConfig.config` declared six settings with documented
 * defaults; the preset hardcoded `max_connections` and `shared_buffers` into
 * `defaultDocker.command` and read the block nowhere. An operator who raised
 * `sharedBuffers` to 4GB in omnitron.stacks.json got 256MB and no word about
 * it — the value was carried as far as `_presetConfig` and handed only to
 * `postProvision`, which reads `databases`.
 *
 * Redis was the same shape with a sharper edge: `maxmemory` was never passed
 * at all, so an eviction policy was configured against no ceiling and
 * therefore never evicted.
 */

import { describe, it, expect } from 'vitest';

import { postgresPreset } from '../../src/infrastructure/presets/postgres.js';
import { redisPreset } from '../../src/infrastructure/presets/redis.js';

/** `['-c', 'k=v']` pairs → `{ k: 'v' }`. */
function settings(command: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < command.length - 1; i++) {
    if (command[i] !== '-c') continue;
    const [k, ...rest] = command[i + 1]!.split('=');
    out[k!] = rest.join('=');
  }
  return out;
}

/** `['--flag', 'value']` pairs → `{ flag: 'value' }`. */
function flags(command: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < command.length - 1; i++) {
    const arg = command[i]!;
    if (arg.startsWith('--')) out[arg.slice(2)] = command[i + 1]!;
  }
  return out;
}

describe('postgres tuning', () => {
  it('passes the operator’s values through to the server', () => {
    const cmd = postgresPreset.buildCommand!({
      config: { maxConnections: 500, sharedBuffers: '4GB', workMem: '64MB' },
    });

    expect(settings(cmd)).toMatchObject({
      max_connections: '500',
      shared_buffers: '4GB',
      work_mem: '64MB',
    });
  });

  it('keeps the documented defaults when nothing is configured', () => {
    const s = settings(postgresPreset.buildCommand!({}));

    expect(s['max_connections']).toBe('200');
    expect(s['shared_buffers']).toBe('256MB');
    expect(s['log_min_duration_statement']).toBe('1000');
  });

  it('omits the settings that have no default rather than inventing one', () => {
    // Unset means "let postgres decide", which beats a number chosen without
    // knowing the machine.
    const s = settings(postgresPreset.buildCommand!({}));

    expect(s).not.toHaveProperty('effective_cache_size');
    expect(s).not.toHaveProperty('work_mem');
    expect(s).not.toHaveProperty('maintenance_work_mem');
  });

  it('honours -1 and 0, which a truthiness test would have swallowed', () => {
    // -1 disables slow-query logging and is a value an operator may mean.
    // `cfg.x || default` would restore 1000 for both and say nothing.
    expect(settings(postgresPreset.buildCommand!({ config: { logMinDurationStatement: -1 } }))[
      'log_min_duration_statement'
    ]).toBe('-1');
    expect(settings(postgresPreset.buildCommand!({ config: { logMinDurationStatement: 0 } }))[
      'log_min_duration_statement'
    ]).toBe('0');
  });

  it('keeps the connection-leak guards out of the operator’s reach', () => {
    // These protect the daemon from its own clients; they are not tuning.
    const s = settings(postgresPreset.buildCommand!({ config: { maxConnections: 10 } }));

    expect(s['idle_in_transaction_session_timeout']).toBe('60000');
    expect(s['tcp_keepalives_idle']).toBe('60');
  });

  it('matches the fallback command when nothing is configured', () => {
    // `defaultDocker.command` is what runs on any path that does not call
    // the builder, so the two must not drift apart.
    expect(settings(postgresPreset.buildCommand!({}))).toEqual(
      settings(postgresPreset.defaultDocker.command!)
    );
  });
});

describe('redis tuning', () => {
  it('sets the memory ceiling it was given', () => {
    // The one setting that was never passed at all.
    expect(flags(redisPreset.buildCommand!({ config: { maxmemory: '2gb' } }))['maxmemory']).toBe('2gb');
  });

  it('passes no ceiling when none is configured', () => {
    expect(redisPreset.buildCommand!({})).not.toContain('--maxmemory');
  });

  it('uses the eviction policy that actually runs, not the one that was documented', () => {
    // The type said 'noeviction'; the preset hardcoded 'allkeys-lru'. The two
    // say opposite things about what happens when memory fills.
    expect(flags(redisPreset.buildCommand!({}))['maxmemory-policy']).toBe('allkeys-lru');
    expect(flags(redisPreset.buildCommand!({ config: { maxmemoryPolicy: 'noeviction' } }))[
      'maxmemory-policy'
    ]).toBe('noeviction');
  });

  it('can be told to turn append-only off', () => {
    expect(flags(redisPreset.buildCommand!({ config: { appendonly: false } }))['appendonly']).toBe('no');
    expect(flags(redisPreset.buildCommand!({ config: { appendonly: true } }))['appendonly']).toBe('yes');
    expect(flags(redisPreset.buildCommand!({}))['appendonly']).toBe('yes');
  });

  it('matches the fallback command when nothing is configured', () => {
    expect(redisPreset.buildCommand!({})).toEqual(redisPreset.defaultDocker.command);
  });
});
