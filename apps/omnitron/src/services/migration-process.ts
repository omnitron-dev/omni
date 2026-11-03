import { ExecutionEngine } from '@xec-sh/core';
import { shellEscape } from '../shared/shell-escape.js';
import type { LocalMigrationTarget } from './migration-target.js';

/** SSH carries credentials on stdin; the remote process receives them only as its environment.
 * The deployment execution fence owns the timeout and process group. Do not retry this command. */
export function prepareRemoteMigration(target: { cwd: string; script: string; node?: string }, env: Record<string, string>) {
  const source = `import {spawn} from 'node:child_process';
    let size=0;const chunks=[];
    for await(const chunk of process.stdin){size+=chunk.length;if(size>1024*1024)throw Error('Migration environment input exceeds 1 MiB');chunks.push(chunk)}
    let env;try{env=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Invalid migration environment input')}
    if(!env||typeof env!=='object'||Array.isArray(env)||Object.entries(env).some(([key,value])=>!/^[_A-Za-z][_A-Za-z0-9]*$/.test(key)||typeof value!=='string'||value.includes('\\0')))throw Error('Invalid migration environment input');
    const child=spawn(process.execPath,[${JSON.stringify(target.script)}],{
      cwd:${JSON.stringify(target.cwd)},env:{...process.env,...env},stdio:['ignore','inherit','inherit']});
    child.once('error',()=>{console.error('Migration process could not start');process.exitCode=1});
    child.once('close',(code,signal)=>{process.exitCode=code??1;if(signal)console.error('Migration process terminated by '+signal)});`;
  const runtime = target.node ? `env -u NODE_OPTIONS -u NODE_PATH ${shellEscape(target.node)}` : 'node';
  return { command: `${runtime} --input-type=module -e ${shellEscape(source)}`, stdin: JSON.stringify(env) };
}

/** One execution only: a disconnected DB may have committed already. Readiness can retry before this call.
 * Xec's internal timeout returns before process close; the owned abort deadline instead waits for the
 * killed local process/stdio. Explicit empty loader variables override Xec 0.11's inherited environment. */
export async function executeLocalMigration(target: LocalMigrationTarget, env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 600_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const engine = new ExecutionEngine({ defaultTimeout: 0, adapters: { local: { killSignal: 'SIGKILL' } } });
  try {
    const result = await engine.execute({ command: process.execPath,
      args: [...(target.sealed ? [] : ['--import', 'tsx/esm']), target.script],
      cwd: target.cwd, shell: false, adapter: 'local', timeout: 0, signal, nothrow: true,
      maxBuffer: 16 * 1024 * 1024,
      env: Object.fromEntries(Object.entries({ ...process.env, ...env,
        ...(target.sealed ? { NODE_OPTIONS: target.nodeOptions, NODE_PATH: '' } : {})
      }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    });
    if (signal.aborted) throw Error('Migration was interrupted');
    if (result.exitCode !== 0) throw Object.assign(Error('Migration process failed; stack startup refused'), {
      stderr: result.stderr, exitCode: result.exitCode,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (signal.aborted) throw Error('Migration interrupted or timed out; outcome may be unknown. Inspect the migration ledger before retrying.', { cause: error });
    throw error;
  } finally { await engine.dispose(); }
}
