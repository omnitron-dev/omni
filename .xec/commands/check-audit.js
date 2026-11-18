import { auditDependencies } from '../release/dependency-audit.js';

export function command(program) {
  program.command('check-audit').description('Audit the locked workspace and verify the installed matcher distributions')
    .allowExcessArguments(false).action(() => auditDependencies(process.cwd(), 'pnpm'));
}
