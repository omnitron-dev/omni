import { reproduceRelease } from '../release/reproduce.js';

export function command(program) {
  program.command('reproduce').description('Compare two independent backend, Console and exact npm archive builds')
    .option('--revision <sha>', 'Exact source revision (default: HEAD)')
    .option('--first <directory>', 'Verified accepted preparation used as independent build 1')
    .option('--out <directory>', 'New destination for the verified runtime and SDK')
    .option('--diagnostics <directory>', 'New directory for bounded mismatch evidence')
    .allowExcessArguments(false)
    .action(values => reproduceRelease(process.cwd(), values));
}
