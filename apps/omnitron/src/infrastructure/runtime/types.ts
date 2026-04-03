/**
 * Container Runtime Interface — Abstracts Docker/Podman/bare-metal.
 *
 * All infrastructure provisioning goes through this interface.
 * Default implementation: DockerRuntime (wraps Docker CLI).
 * Future: PodmanRuntime, BareMetalRuntime (systemd), KubernetesRuntime.
 */

import type { ResolvedContainer, ContainerState } from '../types.js';

export interface IContainerRuntime {
  /** Check if the runtime is available (Docker daemon running, etc.) */
  isAvailable(): Promise<boolean>;

  /** Get current state of a container by name */
  getContainerState(name: string): Promise<ContainerState | null>;

  /** Create and start a container from a resolved spec */
  createContainer(config: ResolvedContainer): Promise<string>;

  /** Start an existing stopped container */
  startContainer(nameOrId: string): Promise<void>;

  /** Stop a running container */
  stopContainer(nameOrId: string, timeoutSeconds?: number): Promise<void>;

  /** Remove a container (force) */
  removeContainer(nameOrId: string): Promise<void>;

  /** Execute a command inside a running container */
  execInContainer(nameOrId: string, command: string[]): Promise<string>;

  /** Wait for container to become healthy */
  waitForHealthy(name: string, timeoutMs: number): Promise<boolean>;

  /** Create a named volume */
  createVolume(name: string): Promise<void>;

  /** Ensure a container image is available locally */
  ensureImage(image: string): Promise<void>;

  /** List all containers managed by omnitron */
  listManagedContainers(): Promise<ContainerState[]>;

  /** Get container logs */
  getContainerLogs(nameOrId: string, tail?: number): Promise<string>;
}
