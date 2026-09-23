/**
 * Infrastructure RPC Service
 *
 * Netron RPC endpoints for infrastructure container management
 * (Docker-based PostgreSQL, Redis, MinIO, etc.).
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { VIEWER_ROLES, OPERATOR_ROLES, CONTROL_PLANE_ROLES, CONTROL_PLANE_READ_ROLES } from '../shared/roles.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import type { InfrastructureConfig, IServiceRequirement } from '../infrastructure/types.js';
import { summariseProvisioning, describeProvisioning } from '../infrastructure/provisioning-outcome.js';
import { withGeneratedCredentials } from '../infrastructure/service-credentials.js';
import { duringPhase } from '../project/deploy-phases.js';
import { containerEndpoint, REDIS_CONTAINER_PORT } from '../infrastructure/service-resolver.js';
import type { InfrastructureState, ContainerState } from '../infrastructure/types.js';
import type { IOmnitronInfraService } from '../shared/dto/services.js';
import {
  startContainer,
  stopContainer,
  removeContainer,
  getContainerLogs,
  listManagedContainers,
} from '../infrastructure/container-runtime.js';

@Service({ name: 'OmnitronInfra' })
export class InfrastructureRpcService implements IOmnitronInfraService {
  constructor(
    private readonly getInfra: () => InfrastructureService | null,
    /**
     * How this daemon builds and adopts an infrastructure it is asked for.
     *
     * The daemon does it, not this service: it holds the logger the node
     * logs through, and it is what has to remember the result — the same
     * field `getState`, the health indicator and the shutdown path read.
     *
     * Absent on a daemon that will not host one, and the call is then
     * refused by name rather than silently doing nothing, which is the
     * difference between "this node does not do that" and "it worked".
     */
    private readonly hostInfra?: (
      config: InfrastructureConfig,
      services: Record<string, IServiceRequirement>,
      registry: import('../infrastructure/presets/registry.js').PresetRegistry,
      overrides: Record<string, import('../infrastructure/types.js').IServiceOverride>,
    ) => InfrastructureService,
    /**
     * This node's secret store.
     *
     * A GETTER, resolved per call. Captured once at boot, a resolution that
     * failed during startup — a container not yet ready, a token registered
     * later — left credential generation off for the life of the daemon,
     * and nothing said so: the absence looks exactly like a daemon that
     * hosts no infrastructure. `getInfra` above is a getter for the same
     * reason.
     *
     * Absent on a daemon that hosts no stack infrastructure, in which case
     * nothing is generated — there is nothing to generate it for.
     */
    private readonly getVault?: () => import('../infrastructure/service-credentials.js').CredentialStore | undefined,
    /**
     * Where this service says what only it knows.
     *
     * Optional in the type and required in practice: the one thing
     * `provisionStack` reports on its own — that a deployment is running on
     * a default credential — is said at error level, and an absent logger
     * turns a safety mechanism into a silent one. It was absent, and the
     * mechanism worked and said nothing.
     */
    /**
     * Narrowed to what this service actually says. It was `error` alone, when
     * the only thing it reported was a deployment running on a default
     * credential; writing a node's config files is worth an `info` and a
     * partial payload a `warn`.
     */
    private readonly logger?: {
      error(obj: object, msg?: string, ...args: any[]): void;
      warn?(obj: object, msg?: string, ...args: any[]): void;
      info?(obj: object, msg?: string, ...args: any[]): void;
    } | undefined,
  ) {}

  /**
   * Bring up the infrastructure a stack needs, here, on this node.
   *
   * A node deployed to by `omnitron stack start` received its applications
   * and nothing for them to connect to. `startRemoteStack` provisioned the
   * daemon, shipped the artifacts and opened the mesh connection; the
   * stack's `infrastructure` block — its Postgres, its Redis, its MinIO —
   * was read by the master and never left it. Worse, a provisioned slave is
   * started with `--no-infra`, and the boot path is guarded by
   * `config.infrastructure && !isSlave`, so a node would not have acted on
   * one even if it had been given one.
   *
   * Everything needed was already here. `InfrastructureService` reconciles
   * containers against a desired set, waits on health, and keeps a janitor
   * for stale endpoints; it runs against the `docker` CLI directly, which is
   * what a provisioned node has. The only thing missing was a way to ask.
   *
   * The master orchestrates and the node executes, which is the same
   * division the mesh already uses: a node that loses its master keeps
   * supervising what it was given.
   *
   * Idempotent, because reconciliation is: calling it twice with the same
   * config leaves the containers alone and returns the same report.
   */
  // CONTROL_PLANE_ROLES, not OPERATOR_ROLES: the caller is a master
  // presenting a `service_role` token minted from this node's own signing
  // secret. Declared for operators only, this method refused the one
  // principal it exists for — `Missing required role`, from a node that had
  // just authenticated that credential.
  @Public({ auth: { roles: CONTROL_PLANE_ROLES } })
  async provisionStack(data: {
    config: InfrastructureConfig;
    /**
     * What the stack's APPLICATIONS declare they need — a chain daemon, a
     * cache, anything an app names in `omnitron.infrastructure`.
     *
     * Sent by the master rather than read here: the node does not have the
     * application definitions when it is asked, and parsing them again on
     * this side would be a second implementation of variant selection and
     * override merging, on the side with less information.
     */
    services?: Record<string, IServiceRequirement> | undefined;
    /**
     * Which stack this is, so the node names its containers the way a local
     * deployment of the same stack would.
     *
     * Without it a node prefixes everything `omnitron-`, which is fine for
     * one stack and a collision for two: the second stack's Postgres would
     * find the first one's container already running under the name it
     * wants, and reconcile it towards its own spec. It also makes the names
     * unpredictable from the master's side, and a hidden service that has to
     * name the gateway container cannot guess.
     */
    project?: string | undefined;
    stack?: string | undefined;
    /**
     * The stack's service overrides — `disabled`, `external`, per-service
     * docker changes. Sent, because a node that does not receive them
     * provisions what the operator asked it not to.
     */
    overrides?: Record<string, import('../infrastructure/types.js').IServiceOverride> | undefined;
    /**
     * Config files the services need, keyed by service name.
     *
     * A gateway is configured by files, and the resolver mounts them from the
     * MASTER's project root — a path this node does not have. Without them the
     * container comes up as bare openresty: measured on the test server, an
     * empty `Mounts` array, a null entrypoint, zero UPSTREAM variables, and an
     * onion answering `Welcome to OpenResty!` over Tor.
     *
     * Validated here rather than trusted: the sender is another daemon, and an
     * older or tampered one is exactly the case a receiving check exists for.
     */
    configFiles?: import('../infrastructure/config-payload.js').ConfigPayload | undefined;
    /**
     * Where each service's static content already is ON THIS NODE, by service
     * name — delivered by SSH before this call, because a build is 32 MB and
     * an RPC argument is the wrong shape for that.
     *
     * A path, not content: this node checks that it exists and mounts it, and
     * refuses one that is not under the directory this daemon owns.
     */
    staticRoots?: Record<string, string> | undefined;
  }): Promise<{
    ready: boolean;
    detail: string;
    running: string[];
    failed: Array<{ name: string; status: string; error: string | null }>;
    missing: string[];
  }> {
    // Named while it runs, so a stall on this node says what it was doing.
    // Test node, 2026-09-22: it went quiet for ten seconds around the end of a
    // provision and nothing here could name it — `monitoring/event-loop-watch.ts`.
    return duringPhase(`provisioning ${data?.project ?? 'omnitron'}/${data?.stack ?? 'default'} for the master`, () =>
      this.provisionStackNow(data),
    );
  }

  /** `provisionStack`'s work. Not an RPC method: it carries no `@Public`. */
  private async provisionStackNow(
    data: Parameters<InfrastructureRpcService['provisionStack']>[0],
  ): ReturnType<InfrastructureRpcService['provisionStack']> {
    if (!this.hostInfra) {
      throw Errors.badRequest('This daemon does not host stack infrastructure.');
    }
    if (!data?.config || typeof data.config !== 'object') {
      throw Errors.badRequest('provisionStack requires an `infrastructure` config.');
    }

    // Reused when this node already has one: reconciliation is idempotent,
    // and building a second service would give the node two janitors and
    // two health monitors over one set of containers.
    // The stack's own block — its Postgres, Redis, MinIO — is written as
    // sugar (`postgres: { image, port, databases }`) and has to be expanded
    // through the preset registry before anything can act on it.
    // `resolveInfrastructure` reads ONLY the normalized services and ignores
    // the raw config it is also handed, so skipping this step is not a
    // degraded provision: it is an empty one that reports success.
    //
    // Measured: a node asked to provision `postgres, redis, minio` answered
    // "Infrastructure: nothing is declared, so nothing was provisioned" —
    // which was true of what it had been given and false of what was asked.
    if (data.project && data.stack) {
      const { setContainerPrefix, setStackLabels } = await import('../infrastructure/service-resolver.js');
      setContainerPrefix(data.project, data.stack);
      setStackLabels(data.project, data.stack);
    }

    const { normalizeInfraConfig } = await import('../infrastructure/config-normalizer.js');
    const { createDefaultRegistry } = await import('../infrastructure/presets/index.js');
    // One registry, used to expand the config AND to run the post-provision
    // hooks that create what is inside those containers — the databases and
    // the buckets. Two registries would be two answers to what a preset is.
    const registry = createDefaultRegistry();

    // Credentials before expansion.
    //
    // Presets ship `minioadmin/minioadmin` and `postgres/postgres` so they
    // work before anyone configures anything — right on a laptop behind
    // loopback, and nothing turned it into anything else, so a stack
    // deployed to a public host ran its object store and its database on
    // the passwords printed in this repository.
    //
    // Generated here, on the node, because the vault belongs to the daemon
    // that creates the container: a master generating them would put a
    // password on the wire to solve a problem the node does not have. And
    // written to the vault on first use, so the SECOND provision reads back
    // what the first one stored — a Postgres data directory keeps the
    // password it was initialised with, and a fresh one each time produces
    // a database that rejects its own application.
    const vault = this.getVault?.();
    if (!vault) {
      // Said, because silence here is indistinguishable from a deployment
      // that needed no credentials at all.
      this.logger?.error(
        { project: data.project, stack: data.stack },
        'No secret store on this node — services will be created with their preset default credentials',
      );
    }
    const config = vault
      ? await withGeneratedCredentials(data.config, {
          project: data.project ?? 'omnitron',
          stack: data.stack ?? 'default',
          vault,
          // The volume is what says whether this service already holds state
          // initialised with another password.
          hasExistingState: async (service) => {
            const { volumeExists } = await import('../infrastructure/container-runtime.js');
            const { getContainerPrefix } = await import('../infrastructure/service-resolver.js');
            return volumeExists(`${getContainerPrefix()}-${service}-data`);
          },
          onLeftOnDefault: (service, field) => {
            // ERROR, because this is a public host running on a published
            // password and nothing else will say so. Naming the fix, because
            // the fix is destructive and must be a decision.
            this.logger?.error(
              { service, secret: field },
              `${service} predates generated credentials and is still on its default ${field}. ` +
                'Its volume holds the old one, so changing it here would break the service. ' +
                'Recreate the service with an empty volume, or set the password explicitly in the stack config.',
            );
          },
        })
      : data.config;

    const fromStack = normalizeInfraConfig(config, registry);

    // An application's declaration wins over the stack's sugar for the same
    // name: the app is the side that knows what it needs of it.
    const declared = { ...fromStack, ...(data.services ?? {}) };
    const service = this.getInfra() ?? this.hostInfra(config, declared, registry, data.overrides ?? {});

    // Containers the applications declare, resolved the same way the master
    // resolves them for a local stack.
    if (Object.keys(data.services ?? {}).length > 0) {
      // Only the app-declared half: the stack's own services are already in
      // the service's desired set, and adding them twice gives one container
      // two entries and the reconciler two opinions about it.
      const { resolveAppInfrastructure } = await import('../infrastructure/service-resolver.js');
      const containers = resolveAppInfrastructure(data.services ?? {});
      if (containers.length > 0) service.addAppContainers(containers);
    }

    // Write what the master sent, and point this node's containers at its own
    // copies. Before `provision()`, because a container created against a
    // path that does not exist yet mounts an empty directory and then has to
    // be recreated to pick the files up.
    const configRoots = await this.writeStackConfigs(data.configFiles, data.project, data.stack);
    const staticRoots = await this.acceptStaticRoots(data.staticRoots);
    if (configRoots.size > 0) {
      // The gateway proxies through Redis for maintenance state, and its
      // resolver needs to know where that is. It is the same Redis this stack
      // just provisioned, on the same network as the gateway — the address
      // the gateway's own container will use, not this daemon's.
      //
      // This said `host.docker.internal` and the host-published port. A node
      // publishes every managed port on 127.0.0.1, so that address goes out
      // to the docker bridge and finds nothing: every gateway request paid a
      // 200ms Redis timeout and the maintenance check failed open, on a
      // machine where the two containers were two IPs apart on one network.
      const redisCfg = (config as { redis?: { port?: number; db?: number; password?: string } }).redis;
      const endpoint = containerEndpoint('redis', REDIS_CONTAINER_PORT);
      service.setConfigRoots(configRoots, staticRoots, {
        host: endpoint.host,
        port: endpoint.port,
        db: (redisCfg?.db ?? 0) + 1,
        ...(redisCfg?.password ? { password: redisCfg.password } : {}),
      });
    }

    const state = await service.provision();
    const outcome = summariseProvisioning(service.getDesiredServices(), state.services);

    // Services that are not containers.
    //
    // Some things should not be. A chain daemon on a server is a system
    // service with a data directory measured in hundreds of gigabytes, a
    // package the distribution updates, and a lifetime longer than any
    // deployment — and the declaration has always been able to say so. It
    // is the same `provisionStack` call because it is the same question:
    // bring this node to what the stack declares.
    const hosted = await this.reconcileHostServices(declared, data.overrides ?? {});

    return {
      ready: outcome.ready && hosted.refusals.length === 0,
      detail: hosted.refusals.length > 0
        ? `${describeProvisioning(outcome)}; host services: ${hosted.refusals.join(' ')}`
        : describeProvisioning(outcome),
      running: [...outcome.running.map((s) => s.name), ...hosted.settled],
      failed: [
        ...outcome.failed.map((s) => ({ name: s.name, status: String(s.status), error: s.error ?? null })),
        ...hosted.failed,
      ],
      missing: outcome.missing.map((s) => s.name),
    };
  }

  /**
   * Bring every declared host service to what the stack says it should be.
   *
   * Driven from the SAME normalized requirements the container path uses, so
   * one declaration describes one service and the operator's choice of which
   * block to fill in is what decides how it runs.
   */
/**
   * Write the master's config files under this node's own root.
   *
   * Returns service name → the directory its files landed in, so the
   * resolver can mount paths that exist HERE instead of paths that exist on
   * the machine that sent them.
   */
/**
   * Accept the static directories a master says it delivered.
   *
   * Two checks, and neither is a formality. The path arrives over RPC from
   * another daemon, so it is confined to the directory this node keeps such
   * things in — a mount source is a path with root's reach, and `/etc` is a
   * directory too. And it must EXIST: a mount of a missing path creates an
   * empty directory and the gateway then serves nothing from it, which looks
   * exactly like a gateway serving a broken build.
   */
  private async acceptStaticRoots(roots: Record<string, string> | undefined): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!roots) return out;

    const fsp = await import('node:fs/promises');
    const ALLOWED_PREFIX = '/opt/omnitron/stack-static/';

    for (const [service, dir] of Object.entries(roots)) {
      if (typeof dir !== 'string' || !dir.startsWith(ALLOWED_PREFIX) || dir.includes('..')) {
        this.logger?.error({ service, dir }, `Refusing a static path outside ${ALLOWED_PREFIX}`);
        continue;
      }
      const stat = await fsp.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) {
        this.logger?.error({ service, dir }, 'The master named a static directory this node does not have');
        continue;
      }
      out.set(service, dir);
      this.logger?.info?.({ service, dir }, 'Serving this service’s static content from the node');
    }
    return out;
  }

  private async writeStackConfigs(
    payload: import('../infrastructure/config-payload.js').ConfigPayload | undefined,
    project: string | undefined,
    stack: string | undefined,
  ): Promise<Map<string, string>> {
    const roots = new Map<string, string>();
    if (!payload || Object.keys(payload).length === 0) return roots;

    const { validatePayload, nodeConfigRoot, writeConfigFiles } = await import('../infrastructure/config-payload.js');
    const problems = validatePayload(payload);
    if (problems.length > 0) {
      // Refused whole, not partially: a gateway that starts with four of its
      // six files serves something, and what it serves is nobody's intention.
      this.logger?.error({ problems }, 'Refusing the config files this master sent');
      return roots;
    }

    const fsp = await import('node:fs/promises');
    const { homeDir } = await import('../shared/env-config.js');
    const { localHost } = await import('../infrastructure/bare-metal-runner.js');
    const host = localHost();

    for (const [service, files] of Object.entries(payload)) {
      const root = nodeConfigRoot(homeDir(), project ?? 'omnitron', stack ?? 'default', service);
      try {
        await writeConfigFiles(
          root,
          files,
          host,
          (path) => fsp.rm(path, { force: true }),
          async (dir) => {
            try {
              const found = await fsp.readdir(dir, { recursive: true, withFileTypes: true });
              return found.filter((e) => e.isFile()).map((e) => `${e.parentPath ?? dir}/${e.name}`.replace(`${dir}/`, ''));
            } catch {
              return [];
            }
          },
        );
        roots.set(service, root);
        this.logger?.info?.({ service, root, files: files.length }, 'Wrote the config files this service needs');
      } catch (err) {
        this.logger?.error(
          { service, root, error: (err as Error).message },
          'Could not write this service\'s config files — it will run unconfigured',
        );
      }
    }
    return roots;
  }

  private async reconcileHostServices(
    declared: Record<string, IServiceRequirement>,
    overrides: Record<string, import('../infrastructure/types.js').IServiceOverride>,
  ): Promise<{
    settled: string[];
    failed: Array<{ name: string; status: string; error: string | null }>;
    refusals: string[];
  }> {
    const { selectBareMetal, planBareMetal, isSettled } = await import('../infrastructure/bare-metal-plan.js');
    const { observeBareMetal, applyBareMetal, localHost } = await import('../infrastructure/bare-metal-runner.js');
    const { createNullLogger } = await import('@omnitron-dev/titan/module/logger');

    const settled: string[] = [];
    const failed: Array<{ name: string; status: string; error: string | null }> = [];
    const refusals: string[] = [];

    const host = localHost();
    const logger = createNullLogger();

    for (const [name, requirement] of Object.entries(declared)) {
      // The stack's override, which `selectBareMetal` has always taken and
      // no caller has ever passed.
      //
      // `networkMode` is the one that matters, and its own docblock says why:
      // an application declares `regtest` because that is right on a laptop,
      // and the stack is the scope that knows when it is not. Without the
      // override the bare-metal path read the application's answer
      // everywhere, so a stack declaring `mainnet` selected the variant that
      // carries the verified download, the hardened unit and the mainnet
      // config — and got the base declaration instead, which names a systemd
      // unit and supplies no template to create it. That refuses, correctly
      // and confusingly: the declaration the operator wrote was never the one
      // being planned.
      const spec = selectBareMetal(name, requirement as never, overrides[name] as never);
      if (!spec) continue;

      const observed = await observeBareMetal(spec, host);
      const plan = planBareMetal(spec, observed);

      if (plan.refusals.length > 0) {
        refusals.push(...plan.refusals);
        failed.push({ name, status: 'refused', error: plan.refusals[0] ?? null });
        continue;
      }

      if (isSettled(plan)) {
        settled.push(name);
        continue;
      }

      const result = await applyBareMetal(plan.actions, host, logger, name);
      if (result.failed) {
        failed.push({ name, status: 'failed', error: result.failed.error });
      } else {
        settled.push(name);
      }
    }

    return { settled, failed, refusals };
  }

  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async getState(): Promise<InfrastructureState | null> {
    const infra = this.getInfra();
    return infra ? infra.getState() : null;
  }

  /**
   * Containers this Omnitron manages, read from the container runtime.
   *
   * This used to return `Object.values(infra.getState().services)` — the
   * daemon's in-memory bookkeeping, which is populated only when THIS daemon
   * process provisioned them. Containers outlive the daemon, so after any
   * restart the map is empty while the containers keep running: `omnitron
   * infra status` listed eleven and the console's containers page listed
   * none, and said "No containers found. Infrastructure containers will
   * appear here when Docker is running" — an empty state indistinguishable
   * from a broken query, which is why it went unnoticed.
   *
   * `listManagedContainers` asks the runtime and filters on the
   * `omnitron.managed` label, so it answers the same in a fresh daemon as in
   * one that did the provisioning — and it is the same call the CLI makes,
   * which is what stops the two from disagreeing again.
   *
   * A runtime that cannot be asked is an error, not an empty list. Asked
   * without `orThrow`, a Docker that did not answer came back as `[]` — the
   * same empty state this comment describes, one layer down: the console's
   * containers page said «No containers found» with 0 running, and the
   * topology read no container's health, while every container ran.
   */
  @Public({ auth: { roles: CONTROL_PLANE_READ_ROLES } })
  async listContainers(): Promise<ContainerState[]> {
    return listManagedContainers({ orThrow: true });
  }

  /**
   * The credentials a service was provisioned with.
   *
   * `CONTROL_PLANE_ROLES`, not `VIEWER_ROLES`, and the change is a
   * tightening as well as a widening. This method returns `password`,
   * `accessKey` and `secretKey` — the platform's own database password among
   * them — and it sat in the READ-ONLY HUMAN tier, so any account that could
   * look at a dashboard could read them. A viewer is someone allowed to see
   * that a service is healthy, not someone allowed to connect to it as its
   * owner.
   *
   * `service_role` is in the set because a master needs this about the nodes
   * it drives: the credentials are generated ON the node, by its own vault,
   * so the node is the only place the answer exists. Without it the master
   * could tell a node to provision a database and could not learn the
   * password to give the applications it then deployed there — which is
   * exactly what happened: six apps handed `postgres:postgres` against a
   * 43-character generated secret.
   */
  @Public({ auth: { roles: CONTROL_PLANE_ROLES } })
  async getConnectionInfo(data: { service: string }): Promise<Record<string, unknown> | null> {
    const infra = this.getInfra();
    if (!infra) return null;
    return infra.getConnectionInfo(data.service);
  }

  // ===========================================================================
  // Container lifecycle
  //
  // The console's containers page has had start / stop / remove / logs buttons
  // all along, wired to methods that existed nowhere — every click 404'd.
  // `container-runtime` already implements each operation; this service simply
  // never exposed them.
  //
  // Every entry point resolves the name against the daemon's OWN managed set
  // first. Without that check an operator role would be able to stop or delete
  // any container on the host — including ones belonging to other projects, or
  // to the daemon's own database — by passing its name.
  // ===========================================================================

  /**
   * @throws when the container is not one this daemon manages.
   */
  private async assertManaged(name: string): Promise<void> {
    // Resolved against the runtime for the same reason as `listContainers`:
    // the in-memory map is empty after a daemon restart, so this rejected
    // every name and the console's start / stop / remove buttons failed with
    // "Managed container not found" against containers that were plainly
    // running in the list beside them.
    const managed = await listManagedContainers();
    if (!managed.some((container) => container.name === name)) {
      throw Errors.notFound('Managed container', name);
    }
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async startContainer(data: { name: string }): Promise<{ success: boolean }> {
    await this.assertManaged(data.name);
    await startContainer(data.name);
    return { success: true };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopContainer(data: { name: string; timeout?: number }): Promise<{ success: boolean }> {
    await this.assertManaged(data.name);
    await stopContainer(data.name, data.timeout);
    return { success: true };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async removeContainer(data: { name: string }): Promise<{ success: boolean }> {
    await this.assertManaged(data.name);
    await removeContainer(data.name);
    return { success: true };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getContainerLogs(data: { name: string; tail?: number }): Promise<{ logs: string }> {
    await this.assertManaged(data.name);
    // Cap the tail so a viewer cannot ask the daemon to buffer an unbounded
    // amount of container output into a single RPC response.
    const tail = Math.min(Math.max(data.tail ?? 100, 1), 5_000);
    return { logs: await getContainerLogs(data.name, tail) };
  }
}
