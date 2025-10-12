/**
 * Process Registry
 *
 * Maintains a registry of all spawned processes and their metadata
 */

import type { IProcessInfo } from './types.js';

/**
 * Registry for managing process information
 */
export class ProcessRegistry {
  private processes = new Map<string, IProcessInfo>();
  private serviceNameIndex = new Map<string, Set<string>>();
  private processClassIndex = new Map<string, Set<string>>();

  /**
   * Register a new process
   */
  register(processInfo: IProcessInfo): void {
    this.processes.set(processInfo.id, processInfo);

    // Update service name index
    if (processInfo.name) {
      if (!this.serviceNameIndex.has(processInfo.name)) {
        this.serviceNameIndex.set(processInfo.name, new Set());
      }
      this.serviceNameIndex.get(processInfo.name)!.add(processInfo.id);
    }
  }

  /**
   * Unregister a process
   */
  unregister(processId: string): void {
    const processInfo = this.processes.get(processId);
    if (!processInfo) return;

    // Remove from service name index
    if (processInfo.name) {
      const serviceSet = this.serviceNameIndex.get(processInfo.name);
      if (serviceSet) {
        serviceSet.delete(processId);
        if (serviceSet.size === 0) {
          this.serviceNameIndex.delete(processInfo.name);
        }
      }
    }

    // Remove from main registry
    this.processes.delete(processId);
  }

  /**
   * Get process by ID
   */
  get(processId: string): IProcessInfo | undefined {
    return this.processes.get(processId);
  }

  /**
   * Find process by service name
   */
  findByServiceName(serviceName: string): IProcessInfo | undefined {
    const processIds = this.serviceNameIndex.get(serviceName);
    if (!processIds || processIds.size === 0) return undefined;

    // Return the first available process
    const processId = processIds.values().next().value;
    return processId ? this.processes.get(processId) : undefined;
  }

  /**
   * Find all processes by service name
   */
  findAllByServiceName(serviceName: string): IProcessInfo[] {
    const processIds = this.serviceNameIndex.get(serviceName);
    if (!processIds) return [];

    return Array.from(processIds)
      .map((id) => this.processes.get(id))
      .filter(Boolean) as IProcessInfo[];
  }

  /**
   * Get all processes
   */
  getAll(): IProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get process count
   */
  get size(): number {
    return this.processes.size;
  }

  /**
   * Clear all processes
   */
  clear(): void {
    this.processes.clear();
    this.serviceNameIndex.clear();
    this.processClassIndex.clear();
  }
}
