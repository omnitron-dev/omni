/**
 * A bind mount whose source is a directory the master ships to a node.
 *
 * A service that names a directory to ship (`shippedDirOf`) has that
 * directory's files sent to every node that runs it, and the node writes them
 * locally (`writeStackConfigs`). Only the gateway then MOUNTED them —
 * `resolveGateway` takes the node's copy. Every other service kept its volumes
 * as the project declared them: absolute paths on the master. On a node such a
 * path does not exist, docker creates an empty directory in its place, and the
 * container finds nothing where its entrypoint should be. Nominatim mounts its
 * import scripts from `infra/nominatim` that way, which is why daos/test could
 * only declare it disabled (2026-09-25).
 *
 * So the master points each bind mount inside a service's shipped directory at
 * `configroot:<service>/<path within it>`, and the node resolves that to its
 * own copy. A source the node cannot resolve is left as it is, and docker
 * refuses it by name — `invalid spec: configroot:nominatim:/opt/nominatim-tools:ro:
 * too many colons` — rather than a path being guessed.
 */
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_ROOT_PREFIX = 'configroot:';

/**
 * One spelling of a path on this machine: symlinks followed as far as the
 * path exists, the rest appended as written.
 *
 * The project root the master deploys from and the paths its config computes
 * are two spellings of one directory more often than not. On this master daos
 * is registered as `…/omni/internal/daos`, a symlink to `/…/dao/daos`, where
 * `omnitron.config.ts` lives and resolves `infra/nominatim` from its own
 * `__dirname`. Compared as written the mount was «outside» the shipped
 * directory, left as the master's path, and Nominatim on daos/test mounted an
 * empty directory the docker daemon made in its place (2026-09-25).
 */
function realOf(p: string): string {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let head = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...rest);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs;
      rest.unshift(path.basename(head));
      head = parent;
    }
  }
}

/**
 * The directory a service asks to have shipped to its nodes, as declared.
 *
 * One question, two spellings: a service written as a requirement names it
 * itself (`configDir`), and a preset service passes it as preset config
 * (`config.configDir`) — the openresty preset's input, which is how the
 * gateway has always been shipped.
 */
export function shippedDirOf(service: unknown): string | undefined {
  const svc = service as { configDir?: unknown; config?: { configDir?: unknown } } | undefined;
  const dir = svc?.configDir ?? svc?.config?.configDir;
  return typeof dir === 'string' && dir !== '' ? dir : undefined;
}

/**
 * Every service a deployment ships a directory for, with the directory as
 * declared: the legacy `gateway` block's, then the stack's own services', then
 * the ones its apps require — one per service, the first declaration winning.
 *
 * Two questions ask it and must get one answer: what the master sends to a
 * node (`readStackConfigFiles`), and what release admission compares with the
 * release's commit, since those files are read from the working tree.
 */
export function shippedDirsOf(
  infrastructure: { gateway?: { configDir?: string | undefined } | undefined; services?: Record<string, unknown> | undefined } | undefined,
  required?: Record<string, unknown>,
): Array<[service: string, dir: string]> {
  const out: Array<[string, string]> = [];
  const legacy = infrastructure?.gateway?.configDir;
  if (typeof legacy === 'string' && legacy !== '') out.push(['gateway', legacy]);
  for (const [name, svc] of [...Object.entries(infrastructure?.services ?? {}), ...Object.entries(required ?? {})]) {
    const dir = shippedDirOf(svc);
    if (dir && !out.some(([n]) => n === name)) out.push([name, dir]);
  }
  return out;
}

type Mount = string | { source: string; target: string; readonly?: boolean };
type Volumes = Record<string, Mount>;
type DockerLike = { volumes?: Volumes; variants?: Record<string, { volumes?: Volumes }> };

/** `source` inside `dir` as `configroot:<service>/<rel>`; anything else unchanged. */
function pointAt(source: string, dir: string, service: string): string {
  const rel = path.relative(dir, source);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return source;
  return rel === '' ? `${CONFIG_ROOT_PREFIX}${service}` : `${CONFIG_ROOT_PREFIX}${service}/${rel.split(path.sep).join('/')}`;
}

function rewrite(volumes: Volumes | undefined, dir: string, service: string, projectRoot: string): Volumes | undefined {
  if (!volumes) return volumes;
  return Object.fromEntries(
    Object.entries(volumes).map(([name, v]) => {
      // A named volume (a bare string, or a source that is not a path) is
      // docker's to keep; only bind mounts name the master's disk.
      if (typeof v === 'string' || !(v.source.startsWith('/') || v.source.startsWith('.'))) return [name, v];
      // Compared in one spelling; a mount that stays the master's keeps the
      // spelling it was declared with.
      const pointed = pointAt(realOf(path.resolve(projectRoot, v.source)), dir, service);
      return [name, pointed.startsWith(CONFIG_ROOT_PREFIX) ? { ...v, source: pointed } : v];
    }),
  );
}

/**
 * The services as a node should see them: each bind mount inside the
 * directory shipped for THAT service names the node's copy of it.
 *
 * @param shipped service → its config directory's absolute path on this master
 * @param projectRoot what relative volume sources are relative to
 */
export function pointMountsAtShippedConfig<S extends Record<string, unknown>>(
  services: S,
  shipped: ReadonlyMap<string, string>,
  projectRoot: string,
): S {
  const out: Record<string, unknown> = {};
  for (const [name, svc] of Object.entries(services)) {
    const declared = shipped.get(name);
    const dir = declared === undefined ? undefined : realOf(declared);
    const docker = (svc as { docker?: DockerLike } | undefined)?.docker;
    if (!dir || !docker) {
      out[name] = svc;
      continue;
    }
    const variants = docker.variants
      ? Object.fromEntries(
          Object.entries(docker.variants).map(([k, v]) => [k, { ...v, volumes: rewrite(v.volumes, dir, name, projectRoot) }]),
        )
      : undefined;
    out[name] = {
      ...(svc as object),
      docker: {
        ...docker,
        ...(docker.volumes ? { volumes: rewrite(docker.volumes, dir, name, projectRoot) } : {}),
        ...(variants ? { variants } : {}),
      },
    };
  }
  return out as S;
}

/**
 * On a node: the local path a `configroot:` source names, and the root it is
 * under — or undefined when no copy arrived for that service, or the path
 * would leave it.
 */
export function shippedMountPath(
  source: string,
  roots: ReadonlyMap<string, string> | undefined,
): { path: string; root: string } | undefined {
  if (!source.startsWith(CONFIG_ROOT_PREFIX)) return undefined;
  const rest = source.slice(CONFIG_ROOT_PREFIX.length);
  const slash = rest.indexOf('/');
  const service = slash < 0 ? rest : rest.slice(0, slash);
  const sub = slash < 0 ? '' : rest.slice(slash + 1);
  const root = roots?.get(service);
  if (!root) return undefined;
  const local = sub ? path.resolve(root, sub) : root;
  const rel = path.relative(root, local);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return { path: local, root };
}
