import { Command } from "commander";

import { Host } from "../../core/inventory/host";
import { OrbitContext } from "../../types/common";
import { Playbook } from "../../core/playbooks/playbook";
import { Inventory } from "../../core/inventory/inventory";
import { PlaybookRunner } from "../../core/playbooks/playbookRunner";

export const deployCommand = (program: Command, context: OrbitContext, inventory: Inventory) => {
  program
    .command('deploy <playbook> [hosts...]')
    .description('Deploy a specified playbook to hosts')
    .option('--dry-run', 'Simulate deployment without executing tasks')
    .action(async (playbookName: string, hostnames: string[], cmdOpts: any) => {
      context.config.dryRun = !!cmdOpts.dryRun;

      const playbooks = context.variables.get('playbooks') as Record<string, Playbook>;
      const playbook = playbooks?.[playbookName];

      if (!playbook) {
        console.error(`Playbook '${playbookName}' not found.`);
        process.exit(1);
      }

      const hosts: Host[] = hostnames.length
        ? hostnames
          .map(name => inventory.getHost(name))
          .filter((host): host is Host => host !== undefined)
        : inventory.listHosts();

      if (!hosts.length) {
        console.error('No valid hosts found.');
        process.exit(1);
      }

      const runner = new PlaybookRunner(context);
      const results = await runner.run(playbook, hosts);

      console.log('Deployment results:', results);
    });
};
