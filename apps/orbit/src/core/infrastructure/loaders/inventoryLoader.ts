import { z } from 'zod';
import { readdirSync } from 'fs';
import { join, extname } from 'path';

import { FileLoader } from '../../utils/fileLoader';
import { Inventory } from '../../inventory/inventory';

// Zod схема для валидации конфигурации хоста
const hostSchema = z.object({
  hostname: z.string(),
  ip: z.string().ip(),
  username: z.string(),
  port: z.number().optional(),
  privateKeyPath: z.string().optional(),
  password: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

// Zod схема для файла инвентаря
const inventoryFileSchema = z.object({
  hosts: z.array(hostSchema),
  groups: z.record(z.array(z.string())).optional(),
});

export class InventoryLoader {
  static load(inventoryDir: string): Inventory {
    const inventory = new Inventory();
    const files = readdirSync(inventoryDir);

    files.forEach((file) => {
      const filePath = join(inventoryDir, file);
      if (['.yml', '.yaml', '.json'].includes(extname(file))) {
        const data = FileLoader.loadFile(filePath, inventoryFileSchema);
        data.hosts.forEach(hostConfig => inventory.addHost(hostConfig));

        if (data.groups) {
          Object.entries(data.groups).forEach(([groupName, hostnames]) => {
            inventory.createGroup(groupName, hostnames as string[]);
          });
        }
      }
    });

    return inventory;
  }
}