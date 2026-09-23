/**
 * The environment a stack gives its apps: `settings.env` for every app,
 * `settings.appEnv[app]` for one, a value either written or named in this
 * daemon's vault — `{ "secret": "<key>" }`.
 *
 * Why it exists. A stack needed to give ONE app a secret of its own — the
 * KMS master key of paysys on daos/test, which fell back to a key derived
 * from a string in its source because nothing set it. The doors there were
 * all wrong: `settings.env` reached a local stack's apps and was silently
 * ignored on a remote one, took no vault reference, and went to every app;
 * a service override's `secrets` belong to an infrastructure service, and a
 * key is not a service.
 *
 * What it refuses, before anything is started:
 *   - a vault key the vault does not hold, or holds empty — an app given an
 *     empty value in place of a key falls back to whatever it does without
 *     one, which for a KMS is the publicly known development key;
 *   - `appEnv` for an app the stack does not run — its variables would reach
 *     nothing, and a misspelt `paysy` would read as configured;
 *   - a name that is not an environment variable name, or a value that is
 *     neither a string nor a vault reference.
 *
 * No value appears in any message: a refusal names the variable, the app and
 * the vault key.
 */

import type { IStackSettings, StackEnvValue } from '../config/types.js';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Every app's stack-given environment, resolved. Apps with none are absent. */
export type StackEnv = Record<string, Record<string, string>>;

export async function resolveStackEnv(input: {
  settings: IStackSettings | undefined;
  /** The bare names of the apps this stack runs. */
  apps: readonly string[];
  getSecret: ((key: string) => Promise<string | null>) | undefined;
  /** `project/stack`, for the refusals. */
  where: string;
}): Promise<StackEnv> {
  const shared = input.settings?.env ?? {};
  const perApp = input.settings?.appEnv ?? {};
  const running = new Set(input.apps);

  const strays = Object.keys(perApp).filter((app) => !running.has(app));
  if (strays.length > 0) {
    throw new Error(
      `${input.where}: settings.appEnv names ${strays.map((a) => `'${a}'`).join(', ')}, which this stack does not run ` +
        `(it runs ${[...running].join(', ') || 'no apps'}) — those variables would reach nothing`,
    );
  }

  // Every reference, with who asked for it, so a refusal can say so.
  const wanted = new Map<string, string[]>();
  const check = (scope: string, table: Record<string, StackEnvValue>): void => {
    for (const [name, value] of Object.entries(table)) {
      if (!ENV_NAME.test(name)) {
        throw new Error(`${input.where}: ${scope} has '${name}', which is not an environment variable name`);
      }
      if (typeof value === 'string') continue;
      const key = value && typeof value === 'object' && typeof value.secret === 'string' ? value.secret.trim() : '';
      if (!key) {
        throw new Error(`${input.where}: ${scope}.${name} is neither a string nor { "secret": "<vault key>" }`);
      }
      wanted.set(key, [...(wanted.get(key) ?? []), `${scope}.${name}`]);
    }
  };
  check('settings.env', shared);
  for (const [app, table] of Object.entries(perApp)) check(`settings.appEnv.${app}`, table ?? {});

  const values = new Map<string, string>();
  if (wanted.size > 0) {
    if (!input.getSecret) {
      throw new Error(
        `${input.where}: ${[...wanted.values()].flat().join(', ')} name vault keys, and this daemon has no vault — ` +
          'refusing to start its apps with empty values in their place',
      );
    }
    const missing: string[] = [];
    for (const key of wanted.keys()) {
      const value = await input.getSecret(key);
      if (value === null || value === '') missing.push(key);
      else values.set(key, value);
    }
    if (missing.length > 0) {
      throw new Error(
        `${input.where}: the vault holds no ${missing.map((k) => `'${k}'`).join(', ')} ` +
          `(named by ${missing.flatMap((k) => wanted.get(k) ?? []).join(', ')}) — refusing to start its apps ` +
          'with an empty value in their place. `omnitron secret generate <key>` makes one without printing it',
      );
    }
  }

  const resolve = (table: Record<string, StackEnvValue>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(table).map(([name, value]) => [name, typeof value === 'string' ? value : values.get(value.secret.trim())!]),
    );
  const sharedResolved = resolve(shared);

  const out: StackEnv = {};
  for (const app of input.apps) {
    const env = { ...sharedResolved, ...resolve(perApp[app] ?? {}) };
    if (Object.keys(env).length > 0) out[app] = env;
  }
  return out;
}
