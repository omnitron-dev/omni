/**
 * ServerRegistry — Persistent registry for remote daemon servers
 *
 * Phase 5 implementation. Stores at ~/.omnitron/servers.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { OMNITRON_HOME } from '../config/defaults.js';
import type { ServerInfoDto } from '../shared/dto/services.js';

export class ServerRegistry {
  private readonly registryFile: string;

  constructor() {
    this.registryFile = path.join(OMNITRON_HOME, 'servers.json');
  }

  list(): ServerInfoDto[] {
    try {
      const data = fs.readFileSync(this.registryFile, 'utf-8');
      return JSON.parse(data) as ServerInfoDto[];
    } catch {
      return [];
    }
  }

  add(server: ServerInfoDto): void {
    const servers = this.list().filter((s) => s.alias !== server.alias);
    servers.push(server);
    this.save(servers);
  }

  remove(alias: string): boolean {
    const servers = this.list();
    const filtered = servers.filter((s) => s.alias !== alias);
    if (filtered.length === servers.length) return false;
    this.save(filtered);
    return true;
  }

  get(alias: string): ServerInfoDto | undefined {
    return this.list().find((s) => s.alias === alias);
  }

  private save(servers: ServerInfoDto[]): void {
    const dir = path.dirname(this.registryFile);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.registryFile, JSON.stringify(servers, null, 2), 'utf-8');
  }
}
