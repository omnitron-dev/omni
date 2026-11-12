import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const turbo = createRequire(import.meta.url).resolve('turbo/bin/turbo');
const composeFile = fileURLToPath(new URL('../../docker-compose.test.yml', import.meta.url));
const compose = ['compose', '--project-name', 'omni-ci-' + randomUUID(), '-f', composeFile];
let child;
let interrupted = 0;
let cleaning = false;

function run(command, args) {
  return new Promise(resolve => {
    child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', error => {
      console.error(error.message);
      resolve(1);
    });
    child.once('exit', (code, signal) => resolve(code ?? 128 + constants.signals[signal]));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted ||= 128 + constants.signals[signal];
    if (!cleaning) child?.kill(signal);
  });
}

let status = 1;
try {
  status = await run('docker', [...compose, 'up', '-d', '--wait']);
  if (!status && !interrupted) status = await run(process.execPath, [turbo, 'test', '--continue=dependencies-successful', ...process.argv.slice(2)]);
} finally {
  cleaning = true;
  const cleanup = await run('docker', [...compose, 'down', '-v']);
  process.exitCode = interrupted || status || cleanup;
}
