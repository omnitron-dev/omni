import type { IEcosystemAppEntry, IAppDefinition } from '../config/types.js';
import type { ProjectDependency } from '../shared/dto/project.js';

const DEFAULT_PORT: Record<string, number> = { postgres: 5432, postgresql: 5432, mysql: 3306, redis: 6379, rediss: 6379, mongodb: 27017, amqp: 5672, amqps: 5671, http: 80, https: 443 };

/** Only endpoint identity leaves the daemon. Userinfo, paths, queries and hashes never do. */
export function topologyEndpoint(value: string): { host: string; port: number } | null {
  if (!value || /\$\{|\{\{|[\r\n]/.test(value)) return null;
  try {
    const url = new URL(value), protocol = url.protocol.slice(0, -1);
    const port = url.port ? Number(url.port) : DEFAULT_PORT[protocol];
    if (!url.hostname || !port || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: url.hostname.toLowerCase().replace(/^\[|\]$/g, ''), port };
  } catch { return null; }
}

/** Read the final launch environment, after the same overrides used by stackEntryBuilder. */
export function appDependencies(project: string, stack: string, entry: IEcosystemAppEntry, definition?: IAppDefinition): ProjectDependency[] {
  const app = entry.name.split('/').at(-1)!;
  const base = { project, stack, app };
  const result: ProjectDependency[] = [];
  const env = entry.env ?? {};
  const names = new Map<string, string>();
  for (const key of Object.keys(env)) {
    if (/(^|_)REDIS_URL$/.test(key)) names.set(key, 'redis');
    else if (key === 'DATABASE_URL' || /(^|_)(POSTGRES|POSTGRESQL|MYSQL|MONGODB|AMQP)_URL$/.test(key)) names.set(key, key === 'DATABASE_URL' ? 'database' : key.replace(/_URL$/, '').toLowerCase());
    else if (/(^|_)S3_ENDPOINT$/.test(key)) names.set(key, 'storage');
  }
  for (const [service, requirement] of Object.entries(definition?.omnitronConfig?.infrastructure ?? {})) {
    for (const key of Object.keys(requirement.env ?? {})) {
      // Only explicit endpoint templates qualify; credentials and unrelated URLs do not.
      if (/(URL|ENDPOINT)$/.test(key)) names.set(key, service);
    }
  }
  for (const [via, service] of names) {
    const value = env[via];
    if (typeof value !== 'string' || !value) continue;
    const address = topologyEndpoint(value);
    if (!address) continue;
    const protocol = value.slice(0, value.indexOf(':')).toLowerCase();
    result.push({ ...base, service: service === 'database' ? (/^postgres/.test(protocol) ? 'postgres' : protocol) : service,
      ...address, via, evidence: 'configuration' });
  }
  for (const dependency of new Set(entry.dependsOn ?? [])) {
    result.push({ ...base, targetApp: dependency, via: 'dependsOn', evidence: 'declaration' });
  }
  return result;
}
