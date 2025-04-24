import { Host } from './host';

export class Group {
  public readonly name: string;
  private readonly hosts: Map<string, Host>;

  constructor(name: string, hosts?: Host[]) {
    this.name = name;
    this.hosts = new Map();
    hosts?.forEach(host => this.hosts.set(host.hostname, host));
  }

  addHost(host: Host): void {
    this.hosts.set(host.hostname, host);
  }

  removeHost(hostname: string): boolean {
    return this.hosts.delete(hostname);
  }

  getHosts(): Host[] {
    return Array.from(this.hosts.values());
  }

  findHostsByTag(tags: string[]): Host[] {
    return this.getHosts().filter(host => host.matchesTags(tags));
  }
}