import { Command } from 'commander';

import { Inventory } from '../../core/inventory/inventory';

export const inventoryCommand = (program: Command, inventory: Inventory) => {
  const invCommand = program.command('inventory').description('Manage inventory');

  invCommand
    .command('list-hosts')
    .description('List all hosts in inventory')
    .action(() => {
      const hosts = inventory.listHosts().map(h => ({
        hostname: h.hostname,
        ip: h.ip,
        username: h.username,
        port: h.port,
        tags: Array.from(h.tags).join(', ')
      }));
      console.table(hosts);
    });

  invCommand
    .command('list-groups')
    .description('List all groups in inventory')
    .action(() => {
      const groups = inventory.listGroups().map(g => ({
        name: g.name,
        hosts: g.getHosts().map(h => h.hostname).join(', ')
      }));
      console.table(groups);
    });
};