/**
 * `omnitron release push|pull <id>` — a release, carried between masters.
 *
 * The work is in `release/artifact-store.ts`; this is what a terminal adds:
 * where the store is (`releaseStore` in `~/.omnitron/config.json`), its key
 * (the daemon's vault, and nowhere else), lines as the objects move, and an
 * exit code.
 *
 * The key is read through the daemon and only through it. `omnitron secret`
 * falls back to decrypting the vault file itself when the daemon is down;
 * this does not, for two reasons. The daemon records every read of a secret
 * in the audit trail, and the file fallback records nothing — a key that
 * opens the fleet's release store is the one read worth having on record.
 * And the fallback is where the two sides once disagreed about the
 * passphrase: a store key that came from somewhere the daemon could not see
 * is a second answer to «which key is this master using». A daemon that is
 * not running is said so, with what to do about it.
 */

import path from 'node:path';

import { log } from '@xec-sh/kit';

import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronSecretsService } from '../shared/dto/services.js';
import {
  parseStoreConfig,
  pullRelease,
  pushRelease,
  resolveStore,
  S3ObjectStore,
  type KeptAttestation,
  type PartTally,
  type ReleasePart,
  type TransferOptions,
} from '../release/artifact-store.js';
import { adviseAbsence, describeAbsence } from './daemon-required.js';
import { emitError, emitJson, isJsonMode } from './output.js';

const CONFIG_SOURCE = '~/.omnitron/config.json';

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

/**
 * The configured store, with its key read from the daemon's vault.
 *
 * The config is read with `readSavedDaemonConfig` — the one reader of that
 * file — and its `releaseStore` checked before the daemon is asked for
 * anything, so a missing store is said as such rather than as a vault miss.
 */
async function openStore(): Promise<S3ObjectStore> {
  const { readSavedDaemonConfig } = await import('./up.js');
  const saved = readSavedDaemonConfig() as { releaseStore?: unknown } | null;
  const config = parseStoreConfig(saved?.releaseStore, CONFIG_SOURCE);

  const client = createDaemonClient();
  try {
    const absence = await client.whyUnreachable();
    if (absence) {
      const advice = adviseAbsence(absence);
      throw new Error(
        `${describeAbsence(absence)} — the artifact store's key is in the daemon's vault and is read through the daemon only.` +
          (advice ? ` ${advice}` : ''),
      );
    }
    const secrets = await client.service<IOmnitronSecretsService>('OmnitronSecrets');
    const resolved = await resolveStore(config, async (key) => (await secrets.get({ key })).value);
    return new S3ObjectStore(resolved);
  } finally {
    await client.disconnect();
  }
}

/**
 * A line every few seconds while objects move, so a transfer to a remote store
 * says it is alive. Nothing in JSON mode: stdout is one object there.
 */
function progressLine(verb: string): NonNullable<TransferOptions['onProgress']> {
  let last = Date.now();
  return (done, total) => {
    if (isJsonMode() || done.files === total.files || Date.now() - last < 3_000) return;
    last = Date.now();
    log.info(`  ${verb} ${done.files} of ${total.files} file(s), ${mb(done.bytes)} of ${mb(total.bytes)} MB`);
  };
}

/** `manifest, 6 artifacts (35.9 MB), 548 statics (26.1 MB), 118 scripts (1.3 MB), no attestations` */
function describeParts(parts: Readonly<Record<ReleasePart, PartTally>>): string {
  const one = (count: number, word: string, bytes: number) =>
    count === 0 ? `no ${word}` : `${count} ${word} (${mb(bytes)} MB)`;
  return [
    parts.manifest.files ? 'manifest' : 'NO manifest',
    one(parts.artifacts.files, 'artifacts', parts.artifacts.bytes),
    one(parts.statics.files, 'statics', parts.statics.bytes),
    one(parts.scripts.files, 'scripts', parts.scripts.bytes),
    one(parts.attestations.files, 'attestations', parts.attestations.bytes),
  ].join(', ');
}

function reportKept(kept: readonly KeptAttestation[], keeper: string): void {
  for (const k of kept) {
    log.warn(`  kept ${keeper}'s ${k.path}: it measured ${k.kept ?? 'at an unreadable time'}, the other copy ${k.offered ?? 'at an unreadable time'}`);
  }
}

function fail(err: unknown): void {
  // Printed either way: one JSON object on stderr, or the terminal's error line.
  emitError((err as Error)?.message ?? String(err));
  process.exitCode = 1;
}

/** `omnitron release push <id> [--repair]` */
export async function releasePushCommand(id: string, options: { root?: string; repair?: boolean } = {}): Promise<void> {
  let store: S3ObjectStore | null = null;
  try {
    store = await openStore();
    if (!isJsonMode()) log.info(`${options.repair ? 'Rewriting' : 'Pushing'} ${id} to ${store.location}…`);
    const result = await pushRelease(id, store, {
      ...(options.root ? { root: path.resolve(options.root) } : {}),
      ...(options.repair ? { repair: true } : {}),
      onProgress: progressLine('uploaded'),
    });
    if (emitJson(result)) return;
    if (result.moved.files === 0) {
      // Said with its limit: «identical» is the index's word, not the objects'.
      log.success(`${id} is already in ${result.location} and its index matches this disk — nothing was written`);
      log.info('  a pull that found an object damaged is answered with --repair, which writes every object again');
    } else {
      log.success(`${options.repair ? 'Rewrote' : 'Pushed'} ${id}: ${result.moved.files} object(s), ${mb(result.moved.bytes)} MB, then the index`);
    }
    log.info(`  ${describeParts(result.parts)}`);
    reportKept(result.keptNewer, 'the store');
    log.info(`  index sha256 ${result.indexSha256}`);
  } catch (err) {
    fail(err);
  } finally {
    store?.close();
  }
}

/** `omnitron release pull <id>` */
export async function releasePullCommand(id: string, options: { root?: string } = {}): Promise<void> {
  let store: S3ObjectStore | null = null;
  try {
    store = await openStore();
    if (!isJsonMode()) log.info(`Pulling ${id} from ${store.location}…`);
    const result = await pullRelease(id, store, {
      ...(options.root ? { root: path.resolve(options.root) } : {}),
      onProgress: progressLine('fetched'),
    });
    if (emitJson(result)) return;
    if (result.alreadyHere) {
      log.success(
        result.moved.files === 0
          ? `${id} is already on this machine, the same build as the store's — nothing was fetched`
          : `${id} is already on this machine, the same build; fetched ${result.moved.files} attestation(s) the store had measured later`,
      );
    } else {
      log.success(`Pulled ${id}: ${result.moved.files} object(s), ${mb(result.moved.bytes)} MB, each matching the store's index`);
    }
    log.info(`  ${describeParts(result.parts)}`);
    log.info(
      `  checked as a deployment takes it: ${result.checked.artifacts} artifact(s) against the manifest` +
        (result.checked.statics ? `, statics ${result.checked.statics.files} files / ${result.checked.statics.bytes} bytes as recorded` : ''),
    );
    reportKept(result.keptNewer, 'this machine');
    log.info(`  ${result.root}`);
    log.info(`  index sha256 ${result.indexSha256}`);
  } catch (err) {
    fail(err);
  } finally {
    store?.close();
  }
}
