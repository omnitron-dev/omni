/**
 * Secrets Service — Encrypted Secrets Storage
 *
 * Stores secrets (API keys, DB passwords, signing keys) encrypted at rest
 * using AES-256-GCM.
 *
 * Key derivation: scrypt(passphrase + machineId, salt, 64) → 32-byte key
 * Encryption: AES-256-GCM with random IV per encryption
 * Storage: SQLite-backed `state_kv` row keyed by `secrets:envelope` via
 *   DaemonStateStore. The encrypted envelope (salt+iv+ciphertext+tag) is
 *   serialised to JSON exactly as before — the DB swap is transparent to
 *   the on-wire format. T-7 in the audit.
 *
 * One-shot legacy migration: when an existing `~/.omnitron/secrets.enc`
 * file is present on first load, its envelope is imported into the
 * `state_kv` row and the file is unlinked. Operators don't have to
 * re-enter the passphrase or lose secrets across the upgrade.
 *
 * Zero external dependencies — uses Node.js native crypto.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { Injectable, Inject, Optional } from '@omnitron-dev/titan/decorators';
import {
  DAEMON_STATE_STORE_TOKEN,
  SECRETS_PASSPHRASE_TOKEN,
  SECRETS_LEGACY_PATH_TOKEN,
} from '../shared/tokens.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import { DEFAULT_SECRETS_PASSPHRASE } from '../config/defaults.js';

const scryptAsync = promisify(scrypt);

/**
 * The passphrase `commands/secret.ts` used to fall back to, before both
 * entry points were pointed at `DEFAULT_SECRETS_PASSPHRASE`. Kept only to
 * read stores written under it; nothing encrypts with it.
 */
const RETIRED_CLI_PASSPHRASE = 'omnitron-default-passphrase';

// =============================================================================
// Types
// =============================================================================

/** Encrypted file envelope — stored as JSON */
interface SecretsEnvelope {
  /** Version of the envelope format */
  version: 1;
  /** scrypt salt (hex) */
  salt: string;
  /** AES-256-GCM IV (hex) */
  iv: string;
  /** Ciphertext (hex) */
  ciphertext: string;
  /** GCM auth tag (hex) */
  tag: string;
}

/** Decrypted secrets store */
type SecretsMap = Record<string, string>;

// =============================================================================
// Constants
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
// scrypt parameters are controlled via Node's defaults (N=16384, r=8, p=1)
// which match our production requirements. Custom tuning can be added
// by passing options to scryptAsync if needed in the future.

// =============================================================================
// Service
// =============================================================================

/** state_kv row key holding the encrypted envelope. */
const SECRETS_KV_KEY = 'secrets:envelope';

/**
 * state_kv row key holding the machine binding the envelope was sealed with.
 *
 * Not a secret — every value it can hold is readable by anyone on the host
 * (`ioreg`, `hostname`). It is here because the binding has to be the SAME
 * string at every derivation, and `probeMachineId` below cannot promise that:
 * it is a chain of fallbacks, and which link answers depends on whether a
 * shell command returned in time.
 */
const MACHINE_ID_KV_KEY = 'secrets:machine-id';

/** The hard-coded last resort of `probeMachineId`. */
const FALLBACK_MACHINE_ID = 'omnitron-default-machine-id';

@Injectable()
export class SecretsService {
  private cache: SecretsMap | null = null;
  /** The resolved machine binding; see `resolveMachineId`. */
  private machineId: string | null = null;

  /**
   * T-2 part 2 — @Inject + useClass. Passphrase + legacy-path
   * arrive via dedicated config-value tokens (useValue providers
   * registered in DaemonModule) so the framework's DI metadata is
   * authoritative for every ctor position. The crypto contract
   * (AES-256-GCM + scrypt + machine-id binding) is unchanged.
   *
   * @param store — DaemonStateStore handle (state_kv row holds the
   *   encrypted envelope).
   * @param passphrase — operator-supplied passphrase. Combined
   *   with the machine ID via scrypt to derive the 256-bit AES key.
   * @param legacyFilePath — optional path to the pre-T-7 encrypted
   *   file. When present + the SQLite row is empty on first load,
   *   the file is imported into the row and unlinked.
   */
  constructor(
    @Inject(DAEMON_STATE_STORE_TOKEN) private readonly store: DaemonStateStore,
    @Inject(SECRETS_PASSPHRASE_TOKEN) private passphrase: string,
    @Optional() @Inject(SECRETS_LEGACY_PATH_TOKEN) private readonly legacyFilePath?: string | null
  ) {}

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get a secret by key.
   * Returns null if the key doesn't exist or the secrets file is missing.
   */
  async get(key: string): Promise<string | null> {
    const secrets = await this.load();
    return secrets[key] ?? null;
  }

  /**
   * Set a secret. Creates or updates the value for the given key.
   * Writes the encrypted file immediately.
   */
  async set(key: string, value: string): Promise<void> {
    const secrets = await this.load();
    secrets[key] = value;
    await this.save(secrets);
  }

  /**
   * Delete a secret by key.
   * Returns true if the key existed and was deleted.
   */
  async delete(key: string): Promise<boolean> {
    const secrets = await this.load();
    if (!(key in secrets)) return false;
    delete secrets[key];
    await this.save(secrets);
    return true;
  }

  /**
   * List all secret keys (values are NOT returned).
   */
  async list(): Promise<string[]> {
    const secrets = await this.load();
    return Object.keys(secrets);
  }

  /**
   * Rotate the encryption key by re-encrypting with a new passphrase.
   * The old passphrase must match the current encryption.
   */
  async rotate(oldPassphrase: string, newPassphrase: string): Promise<void> {
    // Decrypt with the old passphrase via a transient service that
    // shares the same store + legacy-path so the import side-effect
    // (if it hasn't happened yet) lands on the disk we expect.
    const oldService = new SecretsService(this.store, oldPassphrase, this.legacyFilePath ?? null);
    const secrets = await oldService.load();

    // Re-encrypt under the new passphrase. Same store, so the
    // upsert below replaces the row atomically — readers either
    // see the old or the new envelope, never a mix.
    this.passphrase = newPassphrase;
    this.cache = null;
    await this.save(secrets);
  }

  /**
   * Check if any encrypted envelope exists (in SQLite or the legacy
   * file). Pre-T-7 this only checked the filesystem; the SQLite
   * check is async so this method is now async too.
   */
  async exists(): Promise<boolean> {
    const envelope = await this.store.kvGet<SecretsEnvelope>(SECRETS_KV_KEY);
    if (envelope) return true;
    if (this.legacyFilePath && existsSync(this.legacyFilePath)) return true;
    return false;
  }

  // ===========================================================================
  // Encryption / Decryption
  // ===========================================================================

  private async deriveKey(salt: Buffer, machineId?: string): Promise<Buffer> {
    // Combine passphrase with machine-id for additional binding
    const id = machineId ?? (await this.resolveMachineId());
    const combined = `${this.passphrase}:${id}`;
    return scryptAsync(combined, salt, KEY_LENGTH) as Promise<Buffer>;
  }

  /**
   * The machine binding, resolved once and then remembered.
   *
   * `probeMachineId` asks the OS, and on macOS that means shelling out to
   * `ioreg` with a five-second deadline. A host busy enough to miss that
   * deadline falls through to the hostname — silently, and in the middle of
   * `save()`, which re-encrypts the WHOLE map. One degraded write therefore
   * re-keys every secret the daemon holds, and the next read, taken when the
   * probe is fast again, cannot open it.
   *
   * That is not hypothetical. Measured 2026-09-14 on the development daemon:
   * the envelope in `state_kv` held both of the fleet's SSH secrets and
   * decrypted under `hostname` while the daemon derived under
   * `IOPlatformUUID`. The console reported "Failed to decrypt secrets. Wrong
   * passphrase?" — the passphrase was never wrong, and nothing had been lost;
   * the key had simply been built from a different answer to the same
   * question. It surfaced only at a restart, because `NodeManagerService`
   * keeps a pending-secret map that had been serving the plaintext from
   * memory for as long as the process lived.
   *
   * Persisting the answer removes the load dependency: after the first
   * resolution the probe never runs again, so there is no second answer for
   * it to give.
   */
  private async resolveMachineId(): Promise<string> {
    if (this.machineId) return this.machineId;

    const stored = await this.store.kvGet<string>(MACHINE_ID_KV_KEY);
    if (typeof stored === 'string' && stored.length > 0) {
      this.machineId = stored;
      return stored;
    }

    const probed = await this.probeMachineId();
    await this.store.kvSet(MACHINE_ID_KV_KEY, probed);
    this.machineId = probed;
    return probed;
  }

  /**
   * Every machine id this host could plausibly have been sealed under.
   *
   * Ordered by how a pre-persistence daemon would have answered: whatever is
   * stored, then the probe's own chain. Used only to recover an envelope the
   * current binding cannot open.
   */
  private async machineIdCandidates(): Promise<string[]> {
    const seen = new Set<string>();
    const push = (v: string | null | undefined) => {
      if (v && !seen.has(v)) seen.add(v);
    };
    push(await this.resolveMachineId());
    push(await this.probeMachineId());
    push(hostname());
    push(FALLBACK_MACHINE_ID);
    return [...seen];
  }

  private async encrypt(data: SecretsMap): Promise<SecretsEnvelope> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = await this.deriveKey(salt);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(data);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      version: 1,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      ciphertext,
      tag: tag.toString('hex'),
    };
  }

  private async decrypt(envelope: SecretsEnvelope, machineId?: string): Promise<SecretsMap> {
    const salt = Buffer.from(envelope.salt, 'hex');
    const iv = Buffer.from(envelope.iv, 'hex');
    const tag = Buffer.from(envelope.tag, 'hex');
    const key = await this.deriveKey(salt, machineId);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let plaintext = decipher.update(envelope.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return JSON.parse(plaintext) as SecretsMap;
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private async load(): Promise<SecretsMap> {
    if (this.cache) return this.cache;

    // Try the SQLite row first. If it's empty AND the legacy
    // `secrets.enc` file exists, one-shot migrate the file in-place.
    // After the first migration boot the file is gone and the
    // SQLite row is the source of truth.
    let envelope = await this.store.kvGet<SecretsEnvelope>(SECRETS_KV_KEY);

    if (!envelope && this.legacyFilePath && existsSync(this.legacyFilePath)) {
      try {
        const raw = await readFile(this.legacyFilePath, 'utf8');
        envelope = JSON.parse(raw) as SecretsEnvelope;
        // Persist the imported envelope to SQLite BEFORE unlinking
        // — a crash between read and write would otherwise lose
        // the secrets.
        await this.store.kvSet(SECRETS_KV_KEY, envelope);
        try { await unlink(this.legacyFilePath); } catch { /* best-effort */ }
      } catch (err) {
        // Failed to read or parse — leave the legacy file in place
        // and surface the error as an empty store; the operator
        // will see "wrong passphrase" or similar from the next
        // decrypt attempt and can recover manually.
        throw new Error(
          `Failed to import legacy secrets file (${this.legacyFilePath}): ${(err as Error).message}`,
          { cause: err },
        );
      }
    }

    if (!envelope) {
      this.cache = {};
      return this.cache;
    }

    if (envelope.version !== 1) {
      throw new Error(`Unsupported secrets envelope version: ${envelope.version}`);
    }

    try {
      this.cache = await this.decrypt(envelope);
      return this.cache;
    } catch (err) {
      // Before the two entry points shared one default, the CLI's
      // direct-file path used a different passphrase from the daemon's, so a
      // store written through the CLI on a host with no configured
      // passphrase is encrypted under a value neither side uses any more.
      // Read it once with the retired default and re-encrypt under the
      // current one, so unifying the default does not silently strand
      // secrets that were readable yesterday.
      //
      // Only attempted when no passphrase is configured: with an explicit
      // one, a decryption failure means the operator's passphrase is wrong,
      // and trying a hardcoded value would be both useless and alarming.
      const recovered =
        (await this.tryOtherMachineIds(envelope)) ?? (await this.tryRetiredPassphrase(envelope));
      if (recovered) {
        this.cache = recovered;
        await this.save(recovered);
        return this.cache;
      }
      throw new Error(`Failed to decrypt secrets: ${(err as Error).message}. Wrong passphrase?`, { cause: err });
    }
  }

  /**
   * One-shot migration for stores written under the CLI's old default.
   *
   * Returns the secrets if they decrypt under the retired passphrase, null
   * otherwise — including when a passphrase is configured, where a failure
   * is the operator's to resolve.
   */
  private async tryRetiredPassphrase(envelope: SecretsEnvelope): Promise<SecretsMap | null> {
    if (this.passphrase !== DEFAULT_SECRETS_PASSPHRASE) return null;

    const current = this.passphrase;
    this.passphrase = RETIRED_CLI_PASSPHRASE;
    try {
      const secrets = await this.decrypt(envelope);
      return secrets;
    } catch {
      return null;
    } finally {
      // Restored before `save()` runs, so the re-encryption below uses the
      // current passphrase rather than the retired one it just read with.
      this.passphrase = current;
    }
  }

  /**
   * Open an envelope sealed under a machine id this host no longer derives.
   *
   * The binding is not a secret and its candidates are a short, known list,
   * so trying them costs one scrypt each and settles the question the error
   * message could not: whether the passphrase is wrong, or whether the same
   * passphrase was combined with a different answer about the machine.
   *
   * On success the id that worked becomes the persisted binding, so the next
   * derivation opens the envelope directly rather than recovering it again —
   * and `load()` re-encrypts under it, which is a no-op in key terms and
   * leaves the store in the state the rest of this class expects.
   */
  private async tryOtherMachineIds(envelope: SecretsEnvelope): Promise<SecretsMap | null> {
    const current = await this.resolveMachineId();
    for (const candidate of await this.machineIdCandidates()) {
      if (candidate === current) continue;
      try {
        const secrets = await this.decrypt(envelope, candidate);
        await this.store.kvSet(MACHINE_ID_KV_KEY, candidate);
        this.machineId = candidate;
        return secrets;
      } catch {
        // Not this one. The loop is the whole diagnostic.
      }
    }
    return null;
  }

  private async save(secrets: SecretsMap): Promise<void> {
    const envelope = await this.encrypt(secrets);
    // Single atomic SQLite upsert — no torn-write window, no
    // directory creation, no chmod dance. WAL mode + the
    // store's per-key UPSERT covers concurrent writers (CLI +
    // daemon) safely.
    await this.store.kvSet(SECRETS_KV_KEY, envelope);
    this.cache = secrets;
  }

  // ===========================================================================
  // Machine ID
  // ===========================================================================

  /**
   * Ask the OS what machine this is.
   *
   * Called at most once per store — `resolveMachineId` persists the answer —
   * because this is a chain of fallbacks and which link answers depends on
   * the host's load at the moment it runs. Everything that derives a key uses
   * the persisted value, never this.
   */
  private async probeMachineId(): Promise<string> {
    try {
      // Linux: /etc/machine-id
      const { readFile: readFs } = await import('node:fs/promises');
      try {
        const id = await readFs('/etc/machine-id', 'utf8');
        if (id.trim()) return id.trim();
      } catch {
        // Not Linux
      }

      // macOS: IOPlatformUUID.
      //
      // `execFile`, not `execSync`: this used to block the event loop for up
      // to its own five-second deadline, inside a call that can be reached
      // from any RPC handler. The shell is gone with it — the pipe into
      // `grep` was doing work this process can do on the string it gets back.
      try {
        const { execFile } = await import('node:child_process');
        const output = await new Promise<string>((resolve, reject) => {
          execFile(
            'ioreg',
            ['-rd1', '-c', 'IOPlatformExpertDevice'],
            { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 },
            (error, stdout) => (error ? reject(error) : resolve(stdout)),
          );
        });
        const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
        if (match?.[1]) return match[1];
      } catch {
        // Not macOS or command failed
      }

      // Fallback: hostname
      return hostname();
    } catch {
      return FALLBACK_MACHINE_ID;
    }
  }
}
