/**
 * omnitron init — Scaffold omnitron.config.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { log, confirm } from '@xec-sh/kit';

/**
 * The scaffold a new project starts from.
 *
 * It used to be one particular private stack, copied whole: five apps named
 * `main`, `storage`, `pricing`, `payments` and `messaging`, each pointing at
 * `./apps/<name>/src/main.ts` — paths that exist in exactly one repository on
 * earth. Anybody else running `omnitron init` got a config whose every entry
 * was wrong, and `omnitron up` answered with five failures before they had
 * written a line. The same file, dropped into this package's own directory,
 * is why a daemon started here registers five apps that can never run.
 *
 * One entry, obviously an example, is a better starting point than five that
 * look authoritative and are not.
 */
const CONFIG_TEMPLATE = `import { defineEcosystem } from '@omnitron-dev/omnitron';

export default defineEcosystem({
  apps: [
    {
      // Replace with your own — one entry per process omnitron should run.
      name: 'api',
      script: './src/main.ts',
      // bootstrap: './src/bootstrap.ts',  // for a Titan app with child processes
      // critical: true,                   // the stack stops if this one cannot start
      // dependsOn: ['other-app'],
      // watch: './src',                   // restart on change, in development
    },
  ],

  supervision: {
    strategy: 'one_for_one',
    maxRestarts: 5,
    window: 60_000,
    backoff: { type: 'exponential', initial: 1_000, max: 30_000, factor: 2 },
  },

  monitoring: {
    healthCheck: { interval: 15_000, timeout: 5_000 },
    metrics: { interval: 5_000, retention: 3600 },
  },

  env: 'development',
});
`;

export async function initCommand(options: { force?: boolean } = {}): Promise<void> {
  const configPath = path.resolve(process.cwd(), 'omnitron.config.ts');
  const exists = fs.existsSync(configPath);
  if (exists && fs.lstatSync(configPath).isSymbolicLink()) {
    throw new Error('omnitron.config.ts is a symbolic link. Select its project directory explicitly.');
  }
  if (exists && !options.force) {
    if (!process.stdin.isTTY) {
      throw new Error('omnitron.config.ts already exists. Use --force to overwrite it.');
    }
    const overwrite = await confirm({
      message: 'omnitron.config.ts already exists. Overwrite?',
      initialValue: false,
      input: process.stdin,
      output: process.stderr,
    });
    if (overwrite !== true) {
      if (typeof overwrite === 'symbol') process.exitCode = 130;
      log.info('Configuration preserved');
      return;
    }
  }

  const fd = fs.openSync(configPath, exists
    ? fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW
    : 'wx');
  try { fs.writeFileSync(fd, CONFIG_TEMPLATE, 'utf-8'); }
  finally { fs.closeSync(fd); }
  log.success('Created omnitron.config.ts');
}
