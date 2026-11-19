import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { starterConfig } from './starter-plan.js';

/** Publish whole files exclusively. Rollback removes only unchanged files created by this call. */
export function writeStarter(directory: string, files: ReadonlyArray<{ path: string; content: string }>, overwriteConfig = false): () => void {
  const created: Array<{ file: string; ino: number; dev: number; content: string }> = [];
  const rollback = () => {
    for (const item of created) {
      const stat = fs.lstatSync(item.file, { throwIfNoEntry: false });
      if (stat?.isFile() && stat.ino === item.ino && stat.dev === item.dev &&
          stat.size === Buffer.byteLength(item.content) && fs.readFileSync(item.file, 'utf8') === item.content)
        fs.unlinkSync(item.file);
    }
  };
  try {
    // Publish the config last so readers always find its application.
    for (const item of files) {
      const file = path.join(directory, item.path);
      const original = fs.lstatSync(file, { throwIfNoEntry: false });
      if (original && !original.isFile()) throw Error(item.path + ' must be a regular file');
      if (original && item.path !== starterConfig) {
        if (original.size !== Buffer.byteLength(item.content) || fs.readFileSync(file, 'utf8') !== item.content)
          throw Error(item.path + ' already exists with different contents');
        continue;
      }
      if (original && !overwriteConfig) throw Error(item.path + ' already exists');
      const temporary = path.join(directory, '.omnitron-init-' + randomUUID());
      const fd = fs.openSync(temporary, 'wx', original ? original.mode & 0o777 : 0o600);
      try {
        fs.writeFileSync(fd, item.content);
        if (original) {
          const current = fs.lstatSync(file);
          if (current.ino !== original.ino || current.dev !== original.dev || current.ctimeMs !== original.ctimeMs)
            throw Error(item.path + ' changed during initialization');
          fs.renameSync(temporary, file);
        } else {
          const stat = fs.fstatSync(fd);
          fs.linkSync(temporary, file);
          created.push({ file, ino: stat.ino, dev: stat.dev, content: item.content });
        }
      } finally {
        fs.closeSync(fd);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
    }
    return rollback;
  } catch (error) {
    rollback();
    throw error;
  }
}
