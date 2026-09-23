/**
 * How a stack runs a service an application declares: where, on which
 * network, on which ports, with which credentials.
 *
 * Three readers answered this each for itself — the node's container
 * resolver, its bare-metal planner, and the master's resolver of the
 * applications' environment — and their answers had drifted apart on the
 * one service where being wrong costs money. Measured against the test
 * stack, which runs Bitcoin on mainnet (2026-09-23):
 *
 *   - nothing chose between a declaration's `docker` and `bareMetal` blocks:
 *     a node given the service would make the container AND plan the unit;
 *   - the bare-metal templates took their credentials from the
 *     application's declaration — `omni_regtest` / `omni_regtest_dev_password`,
 *     in git — whatever network the stack ran;
 *   - the applications' environment for a service provisioned on the node
 *     read the same declaration: the regtest port and the regtest password,
 *     beside `BITCOIN_NETWORK=mainnet`.
 *
 * One answer now, and one rule for credentials: an application's own
 * `secrets` belong to the network it declares — a laptop's. A stack that
 * runs another network gives its own (`serviceOverrides.<name>.secrets`,
 * vault references), and a credential it does not give is missing, not
 * borrowed from the laptop.
 */

import type { IServiceOverride, IServiceRequirement, SecretRef } from './types.js';

export type Provisioning = 'external' | 'docker' | 'bareMetal' | 'disabled' | 'none';

export interface ServiceBinding {
  /**
   * `none` is a service with nothing to provision it by: no docker block,
   * no bare-metal block, and no address to reach it at.
   */
  provisioning: Provisioning;
  networkMode: string | undefined;
  /** False when the stack runs another network than the declaration names. */
  declaredNetwork: boolean;
  ports: Record<string, number>;
  /** References until the master resolves them; values after. */
  secrets: Record<string, string | SecretRef>;
  /** Where an `external` service is. */
  host?: string | undefined;
}

/** What of a declaration the binding reads. */
type Requirement = {
  networkMode?: string | undefined;
  secrets?: IServiceRequirement['secrets'] | undefined;
  ports?: Record<string, number> | undefined;
  docker?: unknown;
  bareMetal?: unknown;
};

export function bindService(requirement: Requirement, override?: IServiceOverride | undefined): ServiceBinding {
  const networkMode = override?.networkMode ?? requirement.networkMode;
  const declaredNetwork = networkMode === requirement.networkMode;
  // The declaration's credentials serve the network it declares, and no other.
  const own = declaredNetwork ? (requirement.secrets ?? {}) : {};

  if (override?.disabled) {
    return { provisioning: 'disabled', networkMode, declaredNetwork, ports: {}, secrets: {} };
  }

  if (override?.external) {
    return {
      provisioning: 'external',
      networkMode,
      declaredNetwork,
      host: override.external.host,
      ports: { ...override.external.ports },
      secrets: { ...own, ...(override.external.secrets ?? {}) },
    };
  }

  const provisioning: Provisioning =
    override?.provisioning ?? (requirement.docker ? 'docker' : requirement.bareMetal ? 'bareMetal' : 'none');

  return {
    provisioning,
    networkMode,
    declaredNetwork,
    ports: { ...(requirement.ports ?? {}), ...(override?.ports ?? {}) },
    secrets: { ...own, ...(override?.secrets ?? {}) },
  };
}

/**
 * The credentials that are values. A reference still standing — the master
 * did not resolve it, or the vault did not hold it — is left out, so a
 * template needing it reports it unfilled rather than writing
 * `[object Object]` into a config file.
 */
export function secretValues(binding: Pick<ServiceBinding, 'secrets'>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(binding.secrets)) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}
