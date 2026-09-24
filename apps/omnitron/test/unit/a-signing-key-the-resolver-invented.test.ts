/**
 * A signing key the resolver invented.
 *
 * `resolveStack` gave every app `auth.jwtSecret` — a literal written in its
 * own source, the same for every project and every stack, because the
 * parameter that could have carried a real one was passed by no caller — and
 * `resolvedConfigToEnv` turned it into `JWT_SECRET`.
 *
 * On a laptop the project's own value hid it: a local stack merges what the
 * project states over what is computed. A node merges the other way.
 * `selectNodeApps` lays the master's computed env OVER the app's declared
 * one — right for an address the master resolved against what it provisioned
 * there, wrong for this — so on the code path of every remote deployment the
 * project's `JWT_SECRET` went to the node and the invented one was written on
 * top of it.
 *
 * The resolver now produces no signing key. A node gets the project's
 * (`env`), or the stack's (`settings.env`, from the vault, which wins — see
 * `a-secret-a-stack-could-not-give-one-app`), and an app with neither
 * refuses to boot.
 */

import { describe, expect, it } from 'vitest';

import { resolveStack, resolvedConfigToEnv } from '../../src/project/config-resolver.js';
import { selectNodeApps } from '../../src/project/node-app-config.js';
import { ProjectService } from '../../src/services/project.service.js';
import type { IAppDefinition, IEcosystemConfig, IStackConfig } from '../../src/config/types.js';

const declared = (name: string): IAppDefinition => ({
  name,
  version: '1.0.0',
  processes: [{ name: 'http', module: `apps/${name}/src/http.ts` }],
  omnitronConfig: { redis: true, database: true, s3: true },
});

const legacy = (name: string): IAppDefinition => ({
  name,
  version: '1.0.0',
  processes: [{ name: 'http', module: `apps/${name}/src/http.ts` }],
  auth: { jwt: { enabled: true } },
});

const LOCAL: IStackConfig = { type: 'local', apps: 'all' };

describe('the resolver', () => {
  it('computes where an app connects and no key it signs with', () => {
    const config: IEcosystemConfig = { project: 'p', apps: [{ name: 'main' }] };
    const env = resolvedConfigToEnv(resolveStack(config, 'p', 'dev', LOCAL, new Map([['main', declared('main')]])).appConfigs.get('main')!, 'main', 'dev');

    expect(env['DATABASE_URL']).toMatch(/^postgres(ql)?:\/\//);
    expect(env).not.toHaveProperty('JWT_SECRET');
  });

  it('says nothing about a key for an app that declares JWT auth either', () => {
    const config: IEcosystemConfig = { project: 'p', apps: [{ name: 'main' }] };
    const resolved = resolveStack(config, 'p', 'dev', LOCAL, new Map([['main', legacy('main')]])).appConfigs.get('main')!;

    expect(resolved).not.toHaveProperty('auth');
    expect(resolvedConfigToEnv(resolved, 'main', 'dev')).not.toHaveProperty('JWT_SECRET');
  });
});

describe('what a node is given', () => {
  async function nodeEnv(): Promise<Record<string, Record<string, string>>> {
    const svc: any = Object.create(ProjectService.prototype);
    svc.logger = { info() {}, warn() {}, error() {}, debug() {} };
    // The inputs, not the code under test: what the project declares, and no overrides.
    svc.loadAppDefinitions = async () => new Map([['main', declared('main')]]);
    svc.resolveOverrideSecrets = async () => undefined;
    const ecosystem: IEcosystemConfig = { project: 'daos', apps: [{ name: 'main' }] };
    return svc.resolveNodeAppEnv(ecosystem, 'daos', { type: 'remote', apps: 'all' }, [{ name: 'main' }], {});
  }

  it('is computed without a key', async () => {
    const env = await nodeEnv();
    expect(env['main']?.['DATABASE_URL']).toBeTruthy();
    expect(env['main']).not.toHaveProperty('JWT_SECRET');
  });

  it("keeps the project's own key in the config written to the node", async () => {
    const [entry] = selectNodeApps({
      project: 'daos',
      artifactRoot: '/opt/omnitron/artifacts',
      apps: [{ name: 'main', env: { JWT_SECRET: 'the-project-key', NODE_ENV: 'production' } }],
      artifacts: [{ app: 'main', version: '0.0.1' }],
      appEnv: await nodeEnv(),
    });
    expect((entry!['env'] as Record<string, string>)['JWT_SECRET']).toBe('the-project-key');
  });
});
