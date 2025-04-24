import { Command } from 'commander';

import { OrbitContext } from '../../types/common';

export const playbookCommand = (program: Command, context: OrbitContext) => {
  const pbCommand = program.command('playbook').description('Manage playbooks');

  pbCommand
    .command('list')
    .description('List all available playbooks')
    .action(() => {
      console.table(Object.keys(context.variables.get('playbooks')));
    });
};
