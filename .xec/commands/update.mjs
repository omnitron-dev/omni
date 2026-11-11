import { runUpdate } from '../update.mjs';

export function command(program) {
  program.command('update [args...]')
    .description('Prepare and follow managed Omnitron updates through the daemon')
    .allowUnknownOption(true)
    .helpOption(false)
    .action(args => runUpdate(args));
}
