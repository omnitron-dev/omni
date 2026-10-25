/** Durable operator workflows fence ordinary application and fleet mutations. */
import path from 'node:path';
import { shellEscape } from '../shared/shell-escape.js';
export interface HostOperationAllowance {
  /** Operation directory under platform-operations. */
  name: string;
  /** Exact journal identity; allowing a name alone is insufficient. */
  id: string;
}
export function hostOperationBarrierCommand(prefix = '/opt/omnitron', allowance?: HostOperationAllowance): string {
  if (!path.posix.isAbsolute(prefix) || path.posix.normalize(prefix) !== prefix || prefix === '/')
    throw new Error('Canonical absolute host prefix required');
  if (
    allowance &&
    (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(allowance.name) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(allowance.id))
  )
    throw new Error('Invalid scoped host operation allowance');
  const program = `
    const fs = require('node:fs'), path = require('node:path');
    const root = ${JSON.stringify(prefix + '/platform-operations')};
    const allowance = ${JSON.stringify(allowance ?? null)};
    let allowed = false; const pending = [];
    function physical(file, directory) {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || fs.realpathSync(file) !== file) throw Error('Host operation registry path is not physical');
    }
    let presentRoot = true;
    try { fs.lstatSync(root); } catch(error) { if(error.code === 'ENOENT') presentRoot = false; else throw error; }
    if (presentRoot) {
      physical(root, true);
      for (const name of fs.readdirSync(root)) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) throw Error('Invalid host operation directory');
        const directory = path.join(root, name); physical(directory, true);
        const file = path.join(directory, 'pending.json'); let present = true;
        try { fs.lstatSync(file); } catch(error) { if(error.code === 'ENOENT') present = false; else throw error; }
        if (!present) continue;
        physical(file, false);
        const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (journal.schema !== 1 || typeof journal.id !== 'string' || !journal.id || typeof journal.outcome !== 'string') throw Error('Malformed host operation journal: ' + name);
        const terminal = ['complete','completed','rolled-back','recovered'].includes(journal.outcome);
        if (!terminal && !['running','recovery-required'].includes(journal.outcome)) throw Error('Unknown host operation outcome: ' + name);
        if (allowance && allowance.name === name && allowance.id === journal.id && !terminal) allowed = true;
        else if (!terminal) pending.push(name + ':' + journal.id);
      }
    }
    if (pending.length) throw Error('Unfinished host operations require recovery: ' + pending.join(', '));
    if (allowance && !allowed) throw Error('Scoped host operation journal is missing, finished or changed');
    console.log(JSON.stringify({clear:true, scoped:!!allowance}));
  `;
  return 'node -e ' + shellEscape(program);
}
