import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { withKernelFileLock } from '@xec-sh/ops/utils/file-lock';
import { readPrivateRecord, writePrivateRecord } from '../daemon/execution-journal.js';
import { ContainerAllocationRefused, containerSpecHash, ensureImage, preparedContainer } from '../infrastructure/container-runtime.js';
import { resolveOmnitronNginx } from '../infrastructure/service-resolver.js';
import { CONSOLE_INSTANCE_LABEL, consoleContainerName, inspectInstalledConsole } from './console-container.js';
import type { ResolvedContainer } from '../infrastructure/types.js';
import type { RuntimeConsoleConfigIdentity, RuntimeUpdatePlan, RuntimeUpdateReference } from '../shared/dto/runtime-update.js';

type Direction = 'target' | 'previous';
export type ConsolePublication = NonNullable<RuntimeUpdatePlan['consolePublication']>;
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

/** Keep the file descriptor across verification and the write. Docker may have pinned this inode at create. */
async function withConfig<T>(home: string, writable: boolean,
  inspect: (handle: fs.FileHandle, identity: RuntimeConsoleConfigIdentity, contents: string) => Promise<T>) {
  const file = path.join(home, 'webapp/nginx/nginx.conf');
  const handle = await fs.open(file, (writable ? constants.O_RDWR : constants.O_RDONLY) | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    const checkName = async () => {
      const named = await fs.lstat(file, { bigint: true });
      if (!opened.isFile() || named.dev !== opened.dev || named.ino !== opened.ino || named.nlink !== 1n ||
          process.getuid && named.uid !== BigInt(process.getuid()) || await fs.realpath(file) !== file)
        throw Error('The physical Console configuration file changed');
    };
    await checkName();
    const bytes = await handle.readFile(), contents = bytes.toString('utf8');
    if (!bytes.equals(Buffer.from(contents))) throw Error('Invalid UTF-8 in the Console configuration');
    const result = await inspect(handle, { device: String(opened.dev), inode: String(opened.ino), sha256: hash(contents) }, contents);
    await checkName();
    return result;
  } finally { await handle.close(); }
}

export const consoleConfigIdentity = (home: string) => withConfig(home, false, async (_, identity) => identity);

export function consoleSpecification(home: string, dist: string, port: number, address: string, image?: string) {
  const spec = resolveOmnitronNginx({ webappDistPath: dist, port, internalApiPort: port + 1, bindHost: address, ...(image && { image }) });
  spec.name = consoleContainerName(home);
  spec.labels[CONSOLE_INSTANCE_LABEL] = home;
  spec.volumes.push({ source: path.join(home, 'webapp/nginx/nginx.conf'), target: '/etc/nginx/nginx.conf', readonly: true });
  return spec;
}

interface Allocation {
  protocol: 1;
  digest: string;
  direction: Direction;
  artifact: string;
  commit: string;
  specHash: string;
  creation: string;
  originalConfig: string;
  sourceHash: string;
  desiredHash: string;
  id?: string;
  phase: 'allocating' | 'refused' | 'allocated' | 'renaming' | 'starting' | 'published' | 'discarded';
}

/** The native update owns one private journal per reviewed plan and direction, including a lost Docker reply. */
export class ReviewedConsoleAllocation {
  private readonly file: string;
  private readonly spec: ResolvedContainer;
  private readonly staged: ResolvedContainer;

  constructor(private readonly home: string, private readonly digest: string, private readonly direction: Direction,
    private readonly release: RuntimeUpdateReference, private readonly publication: ConsolePublication) {
    if (!/^[a-f0-9]{64}$/.test(digest) || !/^[a-f0-9]{64}$/.test(release.artifact) || !/^[a-f0-9]{40}$/.test(release.commit) ||
        !/^[a-f0-9]{64}$/.test(publication.containerId) || !isIP(publication.address) || !Number.isInteger(publication.port) ||
        publication.port < 1 || publication.port > 65533 || !/^[0-9]+$/.test(publication.configuration?.device) ||
        !/^[0-9]+$/.test(publication.configuration?.inode) || !/^[a-f0-9]{64}$/.test(publication.configuration?.sha256))
      throw Error('Invalid reviewed Console publication');
    const dist = path.join(home, 'runtime/releases', release.artifact, 'packages/0/webapp/dist');
    this.spec = consoleSpecification(home, dist, publication.port, publication.address);
    this.staged = { ...this.spec, name: this.spec.name + '-prepared-' + digest + '-' + direction };
    this.file = path.join(home, 'runtime/local-updates', digest + '-console-' + direction + '.json');
  }

  private async read(): Promise<Allocation | null> {
    const record = await readPrivateRecord<Allocation>(this.file);
    if (record && (record.protocol !== 1 || record.digest !== this.digest || record.direction !== this.direction ||
        record.artifact !== this.release.artifact || record.commit !== this.release.commit || record.specHash !== containerSpecHash(this.spec) ||
        typeof record.originalConfig !== 'string' || hash(record.originalConfig) !== this.publication.configuration.sha256 ||
        !/^[a-f0-9]{64}$/.test(record.sourceHash) || !/^[a-f0-9]{64}$/.test(record.desiredHash) ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(record.creation) ||
        !['allocating', 'refused', 'allocated', 'renaming', 'starting', 'published', 'discarded'].includes(record.phase) ||
        (record.id !== undefined || !['allocating', 'refused', 'discarded'].includes(record.phase)) && !/^[a-f0-9]{64}$/.test(record.id ?? '')))
      throw Error('Prepared Console receipt differs from its reviewed allocation');
    return record;
  }

  private checkConfig(identity: RuntimeConsoleConfigIdentity, allowed: string[]) {
    const expected = this.publication.configuration;
    if (identity.device !== expected.device || identity.inode !== expected.inode || !allowed.includes(identity.sha256))
      throw Error('The Console configuration differs from its reviewed inode or contents');
  }

  async prepare(rendered: string, verified?: { directory: string; assertUnchanged: () => Promise<void> }): Promise<void> {
    await withKernelFileLock(this.file + '.lock', async () => {
      await verified?.assertUnchanged();
      const { inspection } = await inspectInstalledConsole(this.home, this.release,
        verified && path.join(verified.directory, 'packages/0/webapp/dist'));
      const previous = this.direction === 'previous' ? await readPrivateRecord<Allocation>(
        path.join(this.home, 'runtime/local-updates', this.digest + '-console-target.json')) : null;
      if (this.direction === 'previous' && (previous?.digest !== this.digest || previous.direction !== 'target' ||
          typeof previous.originalConfig !== 'string' || hash(previous.originalConfig) !== this.publication.configuration.sha256))
        throw Error('Cannot establish the retained Console configuration');
      const source = await withConfig(this.home, false, async (_, identity, contents) => {
        this.checkConfig(identity, [this.publication.configuration.sha256, ...(previous ? [previous.desiredHash] : [])]);
        return { originalConfig: previous?.originalConfig ?? contents, sourceHash: identity.sha256, desiredHash: hash(previous?.originalConfig ?? rendered) };
      });
      let record = await this.read();
      if (record && !['refused', 'discarded'].includes(record.phase)) {
        if (record.phase !== 'allocating' && record.phase !== 'allocated') throw Error('Prepared Console already entered publication');
        if (record.sourceHash !== source.sourceHash || record.desiredHash !== source.desiredHash) throw Error('The reviewed Console configuration changed');
        const id = await preparedContainer(this.staged, { operation: record.id ? 'verify' : 'discover', creation: record.creation,
          ...(record.id && { id: record.id }) });
        await writePrivateRecord(this.file, { ...record, id, phase: 'allocated' });
      } else {
        await ensureImage(this.spec.image);
        record = { protocol: 1, digest: this.digest, direction: this.direction, ...this.release, specHash: containerSpecHash(this.spec),
          ...source, creation: randomUUID(), phase: 'allocating' };
        await writePrivateRecord(this.file, record);
        try {
          const id = await preparedContainer(this.staged, { operation: 'allocate', creation: record.creation });
          await writePrivateRecord(this.file, { ...record, id, phase: 'allocated' });
        } catch (error) {
          if (error instanceof ContainerAllocationRefused) await writePrivateRecord(this.file, { ...record, phase: 'refused' });
          throw error;
        }
      }
      await inspection?.assertUnchanged();
      await verified?.assertUnchanged();
      this.checkConfig(await consoleConfigIdentity(this.home), [source.sourceHash]);
    });
  }

  async verify(): Promise<void> {
    const record = await this.read();
    if (record?.phase !== 'allocated' || !record.id) throw Error('The reviewed Console has no confirmed preallocation');
    await preparedContainer(this.staged, { operation: 'verify', id: record.id, creation: record.creation });
    this.checkConfig(await consoleConfigIdentity(this.home), [record.sourceHash]);
  }

  async assertCanonicalId(id: string): Promise<void> {
    if ((await this.read())?.id !== id) throw Error('The canonical Console belongs to another allocation');
  }

  async discard(restored = false): Promise<void> {
    await withKernelFileLock(this.file + '.lock', async () => {
      const record = await this.read();
      if (!record || record.phase === 'discarded' || record.phase === 'refused') return;
      // A verified restoration has retired the previously published canonical ID.
      if (restored && record.phase === 'published') return;
      if (!restored && record.phase !== 'allocated' && record.phase !== 'allocating') throw Error('Cannot discard a Console that entered publication');
      await preparedContainer(this.staged, { operation: 'discard', creation: record.creation, ...(record.id && { id: record.id }) });
      await writePrivateRecord(this.file, { ...record, phase: 'discarded' });
    });
  }

  async publish(current: ResolvedContainer, rendered: string): Promise<string> {
    return withKernelFileLock(this.file + '.lock', async () => {
      const record = await this.read();
      if (!record?.id || !['allocated', 'renaming', 'starting', 'published'].includes(record.phase) ||
          current.name !== this.spec.name || containerSpecHash(current) !== record.specHash)
        throw Error('The prepared Console differs from the serving publication policy');
      const desired = this.direction === 'previous' ? record.originalConfig : rendered;
      if (hash(desired) !== record.desiredHash) throw Error('The rendered Console configuration changed since allocation');
      const id = await preparedContainer(current, { operation: 'publish', id: record.id, creation: record.creation, stagedName: this.staged.name,
        issued: record.phase === 'allocated' || record.phase === 'renaming' ? record.phase : 'starting',
        configure: async running => {
          await withConfig(this.home, !running, async (handle, identity) => {
            this.checkConfig(identity, running ? [record.desiredHash] : [record.sourceHash, record.desiredHash]);
            if (identity.sha256 === record.desiredHash) return;
            const bytes = Buffer.from(desired);
            for (let offset = 0; offset < bytes.length;) {
              const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
              if (!bytesWritten) throw Error('Incomplete Console configuration write');
              offset += bytesWritten;
            }
            await handle.truncate(bytes.length);
            await handle.sync();
          });
          this.checkConfig(await consoleConfigIdentity(this.home), [record.desiredHash]);
        },
        record: phase => writePrivateRecord(this.file, { ...record, phase }) });
      await writePrivateRecord(this.file, { ...record, phase: 'published' });
      return id;
    });
  }
}
