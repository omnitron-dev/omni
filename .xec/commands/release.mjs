import { runRelease } from '../release.mjs';

/** The project recipe executes inside Xec's script runtime. */
export function command(program) {
  program.command('release [args...]')
    .description('Qualify, prepare and publish immutable Omnitron releases')
    .allowUnknownOption(true)
    .helpOption(false)
    .action(args => runRelease(args));
}
