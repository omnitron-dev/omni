import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronFilesService, FileLocation } from '../shared/dto/files.js';
import { emitError, emitJson } from './output.js';

export interface FilesOptions {
  node?: string;
  root?: string;
  version?: string;
  from?: string;
  to?: string;
  toNode?: string;
  toRoot?: string;
  toPath?: string;
  name?: string;
  after?: string;
  revision?: string;
}
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const stamp = (s: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }) =>
  [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
/** Every CLI operation uses the same audited contract and ownership as Console. */
export async function filesCommand(action: string, subject: string | undefined, options: FilesOptions): Promise<void> {
  const client = createDaemonClient();
  try {
    const service = await client.service<IOmnitronFilesService>('OmnitronFiles');
    const nodeId = options.node ?? 'local';
    const ref = (): FileLocation => {
      if (!options.root) throw new Error('--root is required');
      return { nodeId, rootId: options.root, path: subject ?? '' };
    };
    let result: unknown;
    switch (action) {
      case 'roots':
        result = await service.roots({ nodeId });
        break;
      case 'list':
        result = await service.list({
          ...ref(),
          ...(options.after ? { after: options.after } : {}),
          ...(options.revision ? { revision: options.revision } : {}),
        });
        break;
      case 'stat':
        result = await service.stat(ref());
        break;
      case 'read':
        result = await service.readText(ref());
        break;
      case 'mkdir':
        result = await service.mkdir(ref());
        break;
      case 'save': {
        if (!options.from || !options.version)
          throw new Error('--from and --version are required; use --version new to create without overwriting');
        const fd = await fs.open(options.from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let content: string;
        try {
          const before = await fd.stat();
          if (!before.isFile() || before.size > 1024 * 1024)
            throw new Error('Editor input must be a regular UTF-8 file up to 1 MiB');
          const bytes = Buffer.alloc(before.size);
          let offset = 0;
          while (offset < bytes.length) {
            const r = await fd.read(bytes, offset, bytes.length - offset, offset);
            if (!r.bytesRead) break;
            offset += r.bytesRead;
          }
          if (offset !== bytes.length || stamp(before) !== stamp(await fd.stat()))
            throw new Error('Local input changed during read');
          content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        } finally {
          await fd.close();
        }
        const bom = content.startsWith('\ufeff');
        result = await service.saveText({
          ...ref(),
          content: bom ? content.slice(1) : content,
          bom,
          version: options.version === 'new' ? null : options.version,
        });
        break;
      }
      case 'rename': {
        if (!options.to || !options.version) throw new Error('--to and --version are required');
        result = await service.rename({ ...ref(), destination: options.to, version: options.version });
        break;
      }
      case 'trash': {
        if (!options.version) throw new Error('--version is required; read it with files stat');
        result = await service.trash({ ...ref(), version: options.version });
        break;
      }
      case 'trash-list':
        result = await service.trashList(ref());
        break;
      case 'restore':
        result = await service.restore({ nodeId, id: subject! });
        break;
      case 'copy': {
        if (!options.toNode || !options.toRoot) throw new Error('--to-node and --to-root are required');
        const source = await service.stat(ref());
        result = await service.copy({
          sources: [{ ...ref(), version: options.version ?? source.version }],
          destination: { nodeId: options.toNode, rootId: options.toRoot, path: options.toPath ?? '' },
        });
        break;
      }
      case 'transfers':
        result = await service.transfers();
        break;
      case 'pause':
      case 'resume':
      case 'cancel':
        result = await service.controlTransfer({ id: subject!, action });
        break;
      case 'upload-status':
        result = await service.uploadStatus({ nodeId, id: subject! });
        break;
      case 'upload-finish':
        result = await service.finishUpload({ nodeId, id: subject! });
        break;
      case 'upload-abort':
        result = await service.abortUpload({ nodeId, id: subject! });
        break;
      case 'upload': {
        if (!options.from) throw new Error('--from is required');
        const fd = await fs.open(options.from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let id: string | undefined,
          committing = false;
        try {
          const before = await fd.stat();
          if (!before.isFile()) throw new Error('Upload source must be a regular file');
          id = randomUUID();
          const session = await service.beginUpload({ ...ref(), size: before.size, id });
          id = session.id;
          let offset = 0;
          while (offset < before.size) {
            const data = Buffer.alloc(Math.min(256 * 1024, before.size - offset));
            const read = await fd.read(data, 0, data.length, offset);
            if (read.bytesRead !== data.length || stamp(before) !== stamp(await fd.stat()))
              throw new Error('Upload source changed');
            const ack = await service.uploadChunk({
              nodeId,
              id,
              offset,
              data: data.toString('base64'),
              sha256: hash(data),
            });
            if (ack.offset !== offset + data.length) throw new Error('Invalid upload acknowledgement');
            offset = ack.offset;
          }
          if (stamp(before) !== stamp(await fd.stat())) throw new Error('Upload source changed before publication');
          committing = true;
          result = await service.finishUpload({ nodeId, id });
          await service.acknowledgeUpload({ nodeId, id }).catch(() => undefined);
        } catch (e) {
          if (id && !committing) await service.abortUpload({ nodeId, id }).catch(() => undefined);
          throw new Error(
            `${(e as Error).message}${id ? `; upload receipt ${id}${committing ? ' requires publication reconciliation' : ''}` : ''}`,
            { cause: e }
          );
        } finally {
          await fd.close();
        }
        break;
      }
      case 'download': {
        if (!options.to) throw new Error('--to is required');
        const entry = await service.stat(ref());
        if (entry.kind !== 'file') throw new Error('Select a regular file');
        const temporary = `${options.to}.omnitron-${randomUUID()}`;
        const fd = await fs.open(temporary, 'wx', 0o600);
        try {
          let offset = 0;
          while (offset < entry.size) {
            const frame = await service.readChunk({ ...ref(), version: options.version ?? entry.version, offset });
            const data = Buffer.from(frame.data, 'base64');
            if (!data.length || frame.offset !== offset || hash(data) !== frame.sha256)
              throw new Error('Invalid download frame');
            await fd.writeFile(data);
            offset += data.length;
          }
          if ((await service.stat(ref())).version !== entry.version)
            throw new Error('Source changed before download completed');
          await fd.sync();
          await fs.link(temporary, options.to);
          result = { path: options.to, bytes: offset };
        } finally {
          await fd.close();
          await fs.unlink(temporary);
        }
        break;
      }
      default:
        throw new Error('Unknown file command');
    }
    if (!emitJson(result)) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (e) {
    emitError((e as Error).message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
