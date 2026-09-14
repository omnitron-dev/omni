/**
 * ServerRegistry — Persistent registry for remote daemon servers
 *
 * Phase 5 implementation. Stores at ~/.omnitron/servers.json
 *
 * Read by `omnitron remote`, `omnitron fleet` and `omnitron deploy`. Note
 * that this is NOT the registry the console's Nodes page and `omnitron node`
 * use — those live in the SQLite `nodes` table via `NodeManagerService`. Two
 * registries for "a remote machine" is a real gap, not a subtlety: a host
 * added in the console is invisible to `omnitron deploy`, and one added with
 * `omnitron remote add` never appears in the fleet view.
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

  /**
   * Every registered server.
   *
   * A missing file means no servers have been registered; a file that cannot
   * be read or parsed means something is wrong, and the two must not give the
   * same answer. They did: one `catch` returned `[]` for both, so a truncated
   * or half-written `servers.json` read as an empty fleet — and `deploy.ts`
   * resolves its targets from this list, so a deploy to a corrupt registry
   * targeted nothing and reported success.
   *
   * @throws when the file exists and cannot be read as a server list.
   */
  list(): ServerInfoDto[] {
    let data: string;
    try {
      data = fs.readFileSync(this.registryFile, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error(`Cannot read the server registry at ${this.registryFile}: ${(err as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      throw new Error(`The server registry at ${this.registryFile} is not valid JSON: ${(err as Error).message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`The server registry at ${this.registryFile} does not contain a list of servers.`);
    }
    return parsed as ServerInfoDto[];
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

  /**
   * Write the list.
   *
   * Through a temporary file and a rename, which is atomic within a
   * filesystem: a crash or a full disk part-way through leaves the previous
   * registry intact rather than a truncated one. Writing in place meant every
   * save had a window in which the file was neither the old list nor the new.
   */
  private save(servers: ServerInfoDto[]): void {
    const dir = path.dirname(this.registryFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.registryFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(servers, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tmp, this.registryFile);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
      throw err;
    }
  }
}
