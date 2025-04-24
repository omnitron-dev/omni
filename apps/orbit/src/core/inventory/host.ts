export interface HostConfig {
  hostname: string;
  ip: string;
  username: string;
  port?: number;
  privateKeyPath?: string;
  password?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export class Host {
  public readonly hostname: string;
  public readonly ip: string;
  public readonly username: string;
  public readonly port: number;
  public readonly privateKeyPath?: string;
  public readonly password?: string;
  public readonly tags: Set<string>;
  public readonly metadata: Record<string, any>;

  constructor(config: HostConfig) {
    this.hostname = config.hostname;
    this.ip = config.ip;
    this.username = config.username;
    this.port = config.port ?? 22;
    this.privateKeyPath = config.privateKeyPath;
    this.password = config.password;
    this.tags = new Set(config.tags || []);
    this.metadata = config.metadata || {};
  }

  matchesTags(tags: string[]): boolean {
    return tags.every(tag => this.tags.has(tag));
  }
}
