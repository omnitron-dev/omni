import { Group } from './group';
import { Host, HostConfig } from './host';

export class Inventory {
  private readonly hosts: Map<string, Host>;
  private readonly groups: Map<string, Group>;

  constructor() {
    this.hosts = new Map();
    this.groups = new Map();
  }

  addHost(config: HostConfig): Host {
    const host = new Host(config);
    this.hosts.set(host.hostname, host);
    return host;
  }

  removeHost(hostname: string): boolean {
    this.groups.forEach(group => group.removeHost(hostname));
    return this.hosts.delete(hostname);
  }

  getHost(hostname: string): Host | undefined {
    return this.hosts.get(hostname);
  }

  listHosts(): Host[] {
    return Array.from(this.hosts.values());
  }

  createGroup(name: string, hostnames?: string[]): Group {
    const hosts = hostnames
      ?.map(hostname => this.hosts.get(hostname))
      .filter((host): host is Host => host !== undefined);

    const group = new Group(name, hosts);
    this.groups.set(name, group);
    return group;
  }

  removeGroup(name: string): boolean {
    return this.groups.delete(name);
  }

  getGroup(name: string): Group | undefined {
    return this.groups.get(name);
  }

  listGroups(): Group[] {
    return Array.from(this.groups.values());
  }

  findHostsByTags(tags: string[]): Host[] {
    return this.listHosts().filter(host => host.matchesTags(tags));
  }
}