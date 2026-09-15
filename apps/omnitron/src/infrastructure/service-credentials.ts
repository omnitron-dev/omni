/**
 * Credentials for the services a stack provisions.
 *
 * Presets carry defaults — `minioadmin/minioadmin`, `postgres/postgres`,
 * `omnitron/omnitron` — because a preset has to work before anyone
 * configures anything, and on a laptop behind loopback that is the right
 * trade. On a server it is not, and nothing turned it into anything else:
 * a stack deployed to a public host ran its object store and its database
 * on the credentials printed in this repository.
 *
 * Two things had to be true for generated credentials to be usable, and
 * both are the whole design here:
 *
 *   1. STABLE. A Postgres data directory keeps the password it was
 *      initialised with. Generating a new one on the next provision
 *      produces a database that rejects its own application, and the
 *      symptom is an authentication failure that looks like a bad config.
 *      So a generated secret is written to the vault on first use and read
 *      back forever after — the generation happens once, the resolution
 *      happens every time.
 *
 *   2. LOCAL TO THE NODE. The vault is the daemon's, and the daemon that
 *      creates the container is the node's. A master that generated these
 *      would have to transmit them, which puts a password on the wire to
 *      solve a problem that does not exist: the node is the only party that
 *      needs it.
 *
 * What is NOT here: rotation. Changing a live database's password is a
 * migration, not a config change, and pretending otherwise by regenerating
 * on some schedule produces exactly the failure point 1 describes.
 */

import { randomBytes } from 'node:crypto';

/** Where a service's credential lives in the vault. */
export function credentialKey(
  project: string,
  stack: string,
  service: string,
  secret: string,
): string {
  return `infra:${project}:${stack}:${service}:${secret}`;
}

/**
 * Secrets that are still whatever the preset shipped.
 *
 * Only these are generated. A value an operator wrote is theirs — including
 * a weak one, because silently replacing a configured password with a
 * random one produces a service nobody can log into and no message saying
 * why.
 */
export function needsGenerating(
  declared: Record<string, string> | undefined,
  presetDefaults: Record<string, string>,
): string[] {
  return Object.keys(presetDefaults).filter((key) => {
    const value = declared?.[key];
    // Unset, or exactly the default the preset ships.
    return value === undefined || value === presetDefaults[key];
  });
}

/**
 * Secrets whose names are identity rather than credential.
 *
 * A username is not a secret: it appears in connection strings, in logs, in
 * `psql -U`, and generating one produces a service an operator cannot reach
 * by hand when something is wrong. Only the values that authenticate are
 * generated.
 */
const IDENTITY_SECRETS = new Set(['user', 'username', 'accessKey']);

export function isCredential(name: string): boolean {
  return !IDENTITY_SECRETS.has(name);
}

/**
 * A password with no encoding surprises in it.
 *
 * base64url rather than base64: these values travel through connection
 * strings, YAML, docker `-e` arguments and shell here-documents, and `+`,
 * `/` and `=` each mean something to at least one of those. 32 bytes is 256
 * bits — the length is not the interesting part, the alphabet is.
 */
export function generateSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Fill in a service's credentials, generating what has never been set.
 *
 * Returns the secrets the container should be created with. Idempotent: the
 * second call returns what the first one stored.
 */
export async function resolveServiceCredentials(options: {
  project: string;
  stack: string;
  service: string;
  presetDefaults: Record<string, string>;
  declared?: Record<string, string> | undefined;
  vault: CredentialStore;
}): Promise<Record<string, string>> {
  const { project, stack, service, presetDefaults, declared, vault } = options;
  const resolved: Record<string, string> = { ...presetDefaults, ...(declared ?? {}) };

  for (const name of needsGenerating(declared, presetDefaults)) {
    if (!isCredential(name)) continue;

    const key = credentialKey(project, stack, service, name);
    const existing = await vault.get(key);
    if (existing) {
      resolved[name] = existing;
      continue;
    }

    const generated = generateSecret();
    await vault.set(key, generated);
    resolved[name] = generated;
  }

  return resolved;
}

// =============================================================================
// Applying this to a stack's infrastructure config
// =============================================================================

/** The three sugar blocks that carry credentials, and which field is which. */
const SUGAR_CREDENTIALS = [
  { service: 'postgres', field: 'password', defaultValue: 'postgres' },
  { service: 'minio', field: 'secretKey', defaultValue: 'minioadmin' },
  // Redis has no default password at all: the preset ships none, and a
  // redis with no `requirepass` accepts anyone who reaches it. On loopback
  // that is the documented posture; generating one here would be a second
  // opinion about a service the preset deliberately leaves open.
] as const;

/**
 * A copy of the config with generated credentials filled in.
 *
 * Applied to the RAW config, before expansion, because the preset registry
 * builds each container's environment from these values at expand time — a
 * secret substituted afterwards would be in the requirement and not in the
 * container.
 *
 * Only the sugar blocks. A service declared the long way, with an explicit
 * `secrets` map, was configured by someone who was looking at it.
 */
export interface CredentialOptions {
  project: string;
  stack: string;
  vault: CredentialStore;
  /**
   * Whether this service already holds state initialised with some other
   * password.
   *
   * A Postgres data directory keeps the password it was created with and
   * ignores `POSTGRES_PASSWORD` thereafter. Generating one for a service
   * that already has a volume produces an application holding a credential
   * the database has never heard of — a failure that reads as a bad config
   * and is fixed by neither side.
   *
   * So generation happens at FIRST provision, where the volume and the
   * vault entry are created together and cannot disagree. A deployment that
   * predates this keeps what it has, and is told.
   */
  hasExistingState?: ((service: string) => Promise<boolean>) | undefined;
  /** Told when an existing deployment is left on a default credential. */
  onLeftOnDefault?: ((service: string, field: string) => void) | undefined;
}

export async function withGeneratedCredentials<T extends Record<string, any>>(
  config: T,
  options: CredentialOptions,
): Promise<T> {
  const next: Record<string, any> = { ...config };

  for (const { service, field, defaultValue } of SUGAR_CREDENTIALS) {
    const block = next[service];
    if (!block || typeof block !== 'object') continue;

    const declared = block[field];
    // A reference into the vault is resolved by the vault, not by us.
    if (declared !== undefined && typeof declared !== 'string') continue;
    if (declared !== undefined && declared !== defaultValue) continue;

    const key = credentialKey(options.project, options.stack, service, field);
    const existing = await options.vault.get(key);

    if (existing) {
      next[service] = { ...block, [field]: existing };
      continue;
    }

    // Nothing in the vault: either this is the first provision, or the
    // service predates generated credentials. The volume answers which.
    if (options.hasExistingState && (await options.hasExistingState(service))) {
      options.onLeftOnDefault?.(service, field);
      continue;
    }

    const secret = generateSecret();
    await options.vault.set(key, secret);
    next[service] = { ...block, [field]: secret };
  }

  return next as T;
}
