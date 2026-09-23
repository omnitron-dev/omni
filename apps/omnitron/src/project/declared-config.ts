/**
 * What an app declares about itself in `config/default.json` — its `omnitron`
 * section (infrastructure, host services, their templates) and its logger
 * level — read from the file NOW.
 *
 * Two readers, the project service (for a deployment) and the orchestrator
 * (for a local start), took the section from the file only «if not already
 * set» — and set it by writing it onto the definition `loadBootstrapConfig`
 * returned. That object is the loader's cache entry, and a daemon imports a
 * bootstrap once, so the first read became the only read: every later
 * deployment, until the daemon restarted, used the file as it had been then.
 *
 * Measured on daos/test, 2026-09-23. The master restarted at 15:45 and read
 * paysys's bitcoind unit template with `Type=notify`; the template was fixed to
 * `Type=exec` at 15:53 (bitcoind sends no readiness signal, so a notify unit
 * never leaves `activating`); the deployment at 16:48, admitted because the
 * working tree was exactly the release's commit, wrote the 15:45 template to
 * the node. The unit hung in `activating (start)` for the next half hour,
 * bitcoind running inside it, `systemctl start` cut off at its deadline.
 *
 * Now the file is read on every call, and the result is a new object: the
 * loader's cached definition is never written to. A section the bootstrap
 * declares in code still wins over the file.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { IAppDefinition, OmnitronAppConfig } from '../config/types.js';

export interface DeclaredConfig {
  configPath: string;
  /** The file's `omnitron` section, when it has one. */
  omnitron?: OmnitronAppConfig;
  /** `logger.level` as written — unvalidated; the caller knows the levels. */
  loggerLevel?: unknown;
  /** Why the file did not parse. Absent when it parsed or does not exist. */
  malformed?: string;
}

/** `<app>/config/default.json` beside `<app>/src/<bootstrap>`, read now. */
export function readDeclaredConfig(bootstrapAbsPath: string): DeclaredConfig {
  const appRoot = path.resolve(path.dirname(bootstrapAbsPath), '..');
  const configPath = path.join(appRoot, 'config', 'default.json');
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    // Absent or unreadable — ordinary: the app has defaults.
    return { configPath };
  }
  try {
    const json = JSON.parse(content) as { omnitron?: OmnitronAppConfig; logger?: { level?: unknown } };
    return {
      configPath,
      ...(json.omnitron ? { omnitron: json.omnitron } : {}),
      ...(json.logger?.level !== undefined ? { loggerLevel: json.logger.level } : {}),
    };
  } catch (err) {
    return { configPath, malformed: (err as Error).message };
  }
}

/**
 * The definition with the file's section — a NEW object. The one passed in
 * is the loader's cache entry and is left as the bootstrap made it.
 */
export function withDeclaredConfig(definition: IAppDefinition, declared: DeclaredConfig): IAppDefinition {
  if (definition.omnitronConfig || !declared.omnitron) return definition;
  return { ...definition, omnitronConfig: declared.omnitron };
}
