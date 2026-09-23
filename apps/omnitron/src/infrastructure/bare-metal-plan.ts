/**
 * What has to happen on a host for a declared bare-metal service to be as
 * declared.
 *
 * `IBareMetalServiceConfig` has described this since it was written —
 * `installCommand`, `systemdUnit`, `configFile` + `configTemplate`,
 * `dataDir`, `user`, `validateCommand`, and variants keyed by `networkMode`.
 * Every field of it was read by nothing: the type existed, the preset
 * registry copied it, and no code path ever acted on one. An operator could
 * declare that a service runs from systemd and get a service that did not
 * run at all.
 *
 * It matters because some things should not be containers. A Bitcoin or
 * Monero node on a server is a system service with a chain directory
 * measured in hundreds of gigabytes, a package the distribution knows how to
 * update, and a lifetime longer than any deployment. Wrapping one in a
 * container to satisfy a provisioning tool is the tool making its own
 * convenience the architecture.
 *
 * This is the planning half, and it is pure: given what is declared and what
 * the host currently looks like, it says what to do and what it cannot do.
 * Executing lives next door, so the decisions can be tested without a host
 * and the same plan can run locally or over SSH.
 */

import { bindService, secretValues } from './service-binding.js';
import type { IServiceOverride, SecretRef } from './types.js';

/** A declared bare-metal service, with its `networkMode` variant applied. */
export interface BareMetalSpec {
  /** Service name, for messages. */
  name: string;
  installCommand?: string | undefined;
  systemdUnit?: string | undefined;
  configFile?: string | undefined;
  /** Rendered content — interpolation happens before planning. */
  configContent?: string | undefined;
  dataDir?: string | undefined;
  user?: string | undefined;
  validateCommand?: string | undefined;
  /** Where the unit file goes, when this provides one. */
  unitFile?: string | undefined;
  /** Rendered unit content, when the host has no unit to adopt. */
  unitContent?: string | undefined;
  /**
   * Placeholders the template could not fill.
   *
   * Carried on the spec so the planner refuses rather than writes. A config
   * with `rpcpassword=` in it starts a mainnet daemon with no password;
   * one with `rpcpassword=${secret:rpc_password}` fails to start and says
   * why. Neither belongs on a host, and this is the check that keeps both
   * off it.
   */
  unresolved?: string[] | undefined;
}

/** What the host looks like right now. */
export interface BareMetalObservation {
  /** `validateCommand` succeeded, or there was none to run. */
  installed: boolean;
  userExists: boolean;
  dataDirExists: boolean;
  unitKnown: boolean;
  unitActive: boolean;
  unitEnabled: boolean;
  /** Current contents of `configFile`, or null when it is not there. */
  configContent: string | null;
  /** Current contents of `unitFile`, or null when it is not there. */
  unitContent?: string | null | undefined;
}

export type BareMetalAction =
  | { type: 'install'; command: string }
  | { type: 'create-user'; user: string }
  | { type: 'create-data-dir'; path: string; owner: string | undefined }
  | { type: 'write-config'; path: string; content: string; owner: string | undefined; mode: string }
  | { type: 'write-unit'; path: string; content: string }
  | { type: 'daemon-reload' }
  | { type: 'enable-unit'; unit: string }
  | { type: 'start-unit'; unit: string }
  | { type: 'restart-unit'; unit: string; because: string };

export interface BareMetalPlan {
  actions: BareMetalAction[];
  /** Things this cannot bring about, each said as what is missing. */
  refusals: string[];
}

/**
 * The marker that says omnitron wrote a config file.
 *
 * A host's existing config was written by a person, and it holds decisions
 * this does not know about — which interfaces to bind, how much bandwidth to
 * use, whether to relay over Tor. Overwriting one because a template
 * disagrees is how a provisioning tool destroys a working service, and the
 * chain directory beside it makes that expensive to undo.
 *
 * So: a file that is absent is written, a file carrying this marker is
 * updated, and a file without it is left exactly alone and reported. The
 * operator adopts it by pasting one line, which is a decision they can see.
 */
export const OMNITRON_CONFIG_MARKER = '# managed-by: omnitron';

/** Config files hold RPC credentials. 0640, owned by the service's user. */
export const CONFIG_MODE = '0640';

export function planBareMetal(spec: BareMetalSpec, observed: BareMetalObservation): BareMetalPlan {
  const actions: BareMetalAction[] = [];
  const refusals: string[] = [];

  // 1. The software itself.
  if (!observed.installed) {
    if (spec.installCommand) {
      actions.push({ type: 'install', command: spec.installCommand });
    } else {
      // Named as the missing declaration rather than as a host problem: the
      // host is fine, the description of it is incomplete.
      refusals.push(
        `${spec.name} is not installed and its declaration has no \`installCommand\` — nothing here can put it there.`,
      );
    }
  }

  // 2. The account it runs as, before anything is owned by it.
  if (spec.user && !observed.userExists) {
    actions.push({ type: 'create-user', user: spec.user });
  }

  // 3. Where its data lives. Never touched when it is already there: the
  //    directory may hold hundreds of gigabytes of chain.
  if (spec.dataDir && !observed.dataDirExists) {
    actions.push({ type: 'create-data-dir', path: spec.dataDir, owner: spec.user });
  }

  // 4. Its configuration.
  let configChanged = false;
  const hasUnfilled = Boolean(spec.unresolved && spec.unresolved.length > 0);
  if (hasUnfilled) {
    refusals.push(
      `${spec.name}'s templates still have ${spec.unresolved!.join(', ')} in them — ` +
        'nothing resolved those, and writing the files as they stand would configure the service with a placeholder.',
    );
  } else if (spec.configFile && spec.configContent !== undefined) {
    const wanted = withMarker(spec.configContent);
    if (observed.configContent === null) {
      actions.push({ type: 'write-config', path: spec.configFile, content: wanted, owner: spec.user, mode: CONFIG_MODE });
      configChanged = true;
    } else if (!observed.configContent.includes(OMNITRON_CONFIG_MARKER)) {
      refusals.push(
        `${spec.configFile} was not written by omnitron, so it is left alone. ` +
          `Add \`${OMNITRON_CONFIG_MARKER}\` to its first line to let this manage it.`,
      );
    } else if (normalise(observed.configContent) !== normalise(wanted)) {
      actions.push({ type: 'write-config', path: spec.configFile, content: wanted, owner: spec.user, mode: CONFIG_MODE });
      configChanged = true;
    }
  }

  // 5. The unit itself, when nothing on the host provides one.
  let unitChanged = false;
  if (spec.systemdUnit && spec.unitContent !== undefined && !hasUnfilled) {
    const path = spec.unitFile ?? `/etc/systemd/system/${spec.systemdUnit}.service`;
    const wanted = withMarker(spec.unitContent);
    const current = observed.unitContent ?? null;

    if (current === null) {
      actions.push({ type: 'write-unit', path, content: wanted });
      unitChanged = true;
    } else if (!current.includes(OMNITRON_CONFIG_MARKER)) {
      // Same rule as a config file, and for a stronger reason: a unit
      // somebody else wrote is how their service starts.
      refusals.push(
        `${path} was not written by omnitron, so it is left alone. ` +
          `Add \`${OMNITRON_CONFIG_MARKER}\` to it to let this manage it.`,
      );
    } else if (normalise(current) !== normalise(wanted)) {
      actions.push({ type: 'write-unit', path, content: wanted });
      unitChanged = true;
    }

    if (unitChanged) actions.push({ type: 'daemon-reload' });
  }

  // 6. Its state — not with a template unfilled. The comment above promises
  //    a placeholder stops everything, and this still enabled and started a
  //    unit systemd already knew: a service brought up on whatever config was
  //    lying on the disk, or none, because its credential was missing.
  if (spec.systemdUnit && !hasUnfilled) {
    if (!observed.unitKnown && !unitChanged) {
      refusals.push(
        `systemd does not know a unit called \`${spec.systemdUnit}\`, and this declaration provides no \`unitTemplate\` — nothing here can create it.`,
      );
    } else {
      if (!observed.unitEnabled) actions.push({ type: 'enable-unit', unit: spec.systemdUnit });

      if (!observed.unitActive) {
        actions.push({ type: 'start-unit', unit: spec.systemdUnit });
      } else if (configChanged || unitChanged) {
        // A running service holds the configuration it started with. Last,
        // so the file is already in place when it re-reads it.
        actions.push({
          type: 'restart-unit',
          unit: spec.systemdUnit,
          because: configChanged && unitChanged ? 'its unit and configuration changed'
            : unitChanged ? 'its unit changed' : 'its configuration changed',
        });
      }
    }
  }

  return { actions, refusals };
}

/** True when the host already matches the declaration. */
export function isSettled(plan: BareMetalPlan): boolean {
  return plan.actions.length === 0 && plan.refusals.length === 0;
}

function withMarker(content: string): string {
  return content.includes(OMNITRON_CONFIG_MARKER) ? content : `${OMNITRON_CONFIG_MARKER}\n${content}`;
}

/**
 * Compared ignoring trailing whitespace and blank lines at the end.
 *
 * A file that differs only in how it ends is the same configuration, and
 * rewriting it would restart the service for nothing — which for a chain
 * daemon is minutes of resynchronisation.
 */
function normalise(content: string): string {
  return content.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
}

// =============================================================================
// Rendering a declared config file
// =============================================================================

/**
 * Fill a `configTemplate` with what the declaration resolved to.
 *
 * The same vocabulary the `env` templates use, because an operator writing
 * both should not have to learn two:
 *
 *   ${port:rpc}      a named port
 *   ${secret:name}   a resolved secret
 *   ${dataDir}       the declared data directory
 *   ${user}          the account it runs as
 *   ${bindAddress}   where it should listen
 *
 * A placeholder with nothing behind it is left in the output verbatim rather
 * than replaced with an empty string. `rpcpassword=` is a config file that
 * starts a daemon with no password on a mainnet node; `rpcpassword=${secret:
 * rpc_password}` is one that fails to start and says why.
 */
export function renderConfigTemplate(
  template: string,
  values: {
    ports?: Record<string, number> | undefined;
    secrets?: Record<string, string> | undefined;
    dataDir?: string | undefined;
    user?: string | undefined;
    bindAddress?: string | undefined;
  },
): { content: string; unresolved: string[] } {
  const unresolved: string[] = [];

  const content = template
    .replace(/\$\{port:(\w[\w-]*)\}/g, (match, name: string) => {
      const port = values.ports?.[name];
      if (port === undefined) { unresolved.push(match); return match; }
      return String(port);
    })
    .replace(/\$\{secret:(\w[\w-]*)\}/g, (match, name: string) => {
      const secret = values.secrets?.[name];
      if (secret === undefined || secret === '') { unresolved.push(match); return match; }
      return secret;
    })
    .replace(/\$\{(dataDir|user|bindAddress)\}/g, (match, key: string) => {
      const value = (values as Record<string, string | undefined>)[key];
      if (value === undefined || value === '') { unresolved.push(match); return match; }
      return value;
    });

  return { content, unresolved };
}

/**
 * The bare-metal half of a stack's declared services.
 *
 * A requirement describes one service two ways — as a container and as a
 * host service — and `networkMode` picks the variant of each. Which one is
 * used is the operator's choice, expressed by which block they filled in:
 * a requirement with a `bareMetal` block is a host service, and its
 * container config, if any, is what the same thing looks like on a laptop.
 */
export function selectBareMetal(
  name: string,
  requirement: {
    bareMetal?: object | undefined;
    docker?: unknown;
    networkMode?: string | undefined;
    ports?: Record<string, number> | undefined;
    secrets?: Record<string, string | SecretRef> | undefined;
  },
  override?: IServiceOverride | undefined,
): BareMetalSpec | null {
  // Only a service this stack runs on the node. One it declares EXTERNAL
  // names an address and credentials for something already running — a
  // chain daemon whose data directory is measured in hundreds of gigabytes —
  // and installing a second beside it is the opposite of what was asked. One
  // it runs as a container is not a unit as well: a node given paysys's
  // bitcoin, which declares both blocks, made the container AND planned the
  // unit, because nothing chose (`bindService`).
  const binding = bindService(requirement, override);
  if (binding.provisioning !== 'bareMetal') return null;

  const base = requirement.bareMetal as
    | (Omit<BareMetalSpec, 'name'> & { configTemplate?: string; bindAddress?: string; variants?: Record<string, Record<string, unknown>> })
    | undefined;
  if (!base) return null;

  // base → the network's variant → the stack's override. The stack decides
  // the network, because an application declares the one that is right on a
  // laptop and a stack is the scope that knows when it is not.
  const networkMode = override?.networkMode ?? requirement.networkMode;
  const variant = networkMode ? base.variants?.[networkMode] : undefined;
  const merged = { ...base, ...(variant ?? {}), ...(override?.bareMetal ?? {}) } as Omit<BareMetalSpec, 'name'> & {
    configTemplate?: string;
    bindAddress?: string;
  };

  const spec: BareMetalSpec = { name };
  if (merged.installCommand) spec.installCommand = merged.installCommand;
  if (merged.systemdUnit) spec.systemdUnit = merged.systemdUnit;
  if (merged.configFile) spec.configFile = merged.configFile;
  if (merged.dataDir) spec.dataDir = merged.dataDir;
  if (merged.user) spec.user = merged.user;
  if (merged.validateCommand) spec.validateCommand = merged.validateCommand;

  // Ports and credentials as this stack runs the service: the declaration's
  // only for the network the declaration names.
  const values = {
    ports: binding.ports,
    secrets: secretValues(binding),
    dataDir: merged.dataDir,
    user: merged.user,
    bindAddress: merged.bindAddress,
  };
  const unresolved: string[] = [];

  if (merged.configTemplate) {
    const rendered = renderConfigTemplate(merged.configTemplate, values);
    spec.configContent = rendered.content;
    unresolved.push(...rendered.unresolved);
  }

  const withUnit = merged as typeof merged & { unitTemplate?: string; unitFile?: string };
  if (withUnit.unitTemplate) {
    const rendered = renderConfigTemplate(withUnit.unitTemplate, values);
    spec.unitContent = rendered.content;
    unresolved.push(...rendered.unresolved);
  }
  if (withUnit.unitFile) spec.unitFile = withUnit.unitFile;

  // A placeholder anywhere stops everything. A unit that names a data
  // directory it could not resolve starts a daemon in the wrong place, and
  // for a chain daemon the wrong place is a second copy of the chain.
  if (unresolved.length > 0) {
    spec.unresolved = [...new Set(unresolved)].map((placeholder) => {
      // A credential the declaration has and the stack did not give: said as
      // what to write, because "unfilled" alone reads as a bug here rather
      // than as the laptop's password withheld from a server on purpose.
      const secret = /^\$\{secret:([\w-]+)\}$/.exec(placeholder)?.[1];
      if (!secret || binding.declaredNetwork) return placeholder;
      const declared =
        requirement.secrets?.[secret] !== undefined ? `; the declaration's is for ${requirement.networkMode}` : '';
      return (
        `${placeholder} (the stack runs ${binding.networkMode} and gives no ${secret}${declared} — ` +
        `give one in serviceOverrides.${name}.secrets)`
      );
    });
  }

  return spec;
}
