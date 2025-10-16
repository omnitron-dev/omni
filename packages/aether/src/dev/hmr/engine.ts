/**
 * HMR Engine
 *
 * Hot Module Replacement engine for Aether dev server
 */

import type {
  HMRConfig,
  HMRUpdate,
  HMRPayload,
  HMREngine as IHMREngine,
  ModuleGraph,
  ModuleNode,
} from '../types.js';

/**
 * Module Graph Implementation
 */
class ModuleGraphImpl implements ModuleGraph {
  idToModuleMap = new Map<string, ModuleNode>();
  fileToModulesMap = new Map<string, Set<ModuleNode>>();

  getModuleById(id: string): ModuleNode | undefined {
    return this.idToModuleMap.get(id);
  }

  getModulesByFile(file: string): Set<ModuleNode> {
    return this.fileToModulesMap.get(file) || new Set();
  }

  invalidateModule(mod: ModuleNode): void {
    mod.lastHMRTimestamp = Date.now();

    // Invalidate all importers
    for (const importer of mod.importers) {
      this.invalidateModule(importer);
    }
  }

  updateModuleInfo(mod: ModuleNode, imported: Set<string>): void {
    // Clear old imports
    for (const oldImport of mod.importedModules) {
      oldImport.importers.delete(mod);
    }

    mod.importedModules.clear();

    // Add new imports
    for (const id of imported) {
      const importedMod =
        this.idToModuleMap.get(id) || this.createModule(id, 'module');
      mod.importedModules.add(importedMod);
      importedMod.importers.add(mod);
    }
  }

  createModule(id: string, type: ModuleNode['type']): ModuleNode {
    const mod: ModuleNode = {
      id,
      file: id,
      type,
      importers: new Set(),
      importedModules: new Set(),
      acceptedHmr: false,
      isSelfAccepting: false,
      lastHMRTimestamp: 0,
    };

    this.idToModuleMap.set(id, mod);

    // Map file to module
    const mods = this.fileToModulesMap.get(id) || new Set();
    mods.add(mod);
    this.fileToModulesMap.set(id, mods);

    return mod;
  }

  getAffectedModules(file: string): Set<ModuleNode> {
    const affected = new Set<ModuleNode>();
    const modules = this.getModulesByFile(file);

    for (const mod of modules) {
      this.collectAffected(mod, affected);
    }

    return affected;
  }

  private collectAffected(mod: ModuleNode, affected: Set<ModuleNode>): void {
    if (affected.has(mod)) return;

    affected.add(mod);

    // Don't traverse beyond HMR boundaries
    if (mod.acceptedHmr || mod.isSelfAccepting) {
      return;
    }

    // Traverse importers
    for (const importer of mod.importers) {
      this.collectAffected(importer, affected);
    }
  }
}

/**
 * HMR Engine Implementation
 */
export class HMREngine implements IHMREngine {
  private connections = new Set<WebSocket>();
  private moduleGraph: ModuleGraphImpl;
  private config: HMRConfig;
  private updateQueue: HMRUpdate[] = [];
  private processing = false;

  constructor(config: HMRConfig = {}) {
    this.config = {
      preserveState: true,
      reloadOnError: false,
      timeout: 30000,
      boundaries: [],
      ...config,
    };

    this.moduleGraph = new ModuleGraphImpl();
  }

  /**
   * Add WebSocket connection
   */
  addConnection(ws: WebSocket): void {
    this.connections.add(ws);

    // Send connected message
    this.send(ws, {
      type: 'connected',
    });
  }

  /**
   * Remove WebSocket connection
   */
  removeConnection(ws: WebSocket): void {
    this.connections.delete(ws);
  }

  /**
   * Get all connections
   */
  getConnections(): Set<WebSocket> {
    return this.connections;
  }

  /**
   * Handle file update
   */
  async handleUpdate(file: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Get affected modules
      const affected = this.moduleGraph.getAffectedModules(file);

      if (affected.size === 0) {
        // No modules affected, might be a new file
        await this.sendUpdate({
          type: 'full-reload',
          path: file,
          timestamp: Date.now(),
        });
        return;
      }

      // Find HMR boundary
      const boundary = this.findBoundary(affected);

      if (boundary) {
        // Partial update
        const update: HMRUpdate = {
          type: 'update',
          path: file,
          timestamp: Date.now(),
          acceptedPath: boundary.id,
        };

        await this.sendUpdate(update);

        // Invalidate affected modules
        for (const mod of affected) {
          this.moduleGraph.invalidateModule(mod);
        }
      } else {
        // No boundary found, full reload needed
        await this.sendUpdate({
          type: 'full-reload',
          path: file,
          timestamp: Date.now(),
        });
      }

      // Call onUpdate handler
      if (this.config.onUpdate) {
        const update: HMRUpdate = {
          type: boundary ? 'update' : 'full-reload',
          path: file,
          timestamp: Date.now(),
          acceptedPath: boundary?.id,
        };

        await this.config.onUpdate(update);
      }

      const duration = Date.now() - startTime;
      console.log(
        `[HMR] Updated ${file} in ${duration}ms (affected: ${affected.size})`
      );
    } catch (error) {
      console.error('[HMR] Update error:', error);

      if (this.config.onError) {
        this.config.onError(error as Error);
      }

      // Send error to clients
      await this.sendUpdate({
        type: 'error',
        path: file,
        timestamp: Date.now(),
      });

      if (this.config.reloadOnError) {
        await this.sendUpdate({
          type: 'full-reload',
          path: file,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Send HMR update to all clients
   */
  async sendUpdate(update: HMRUpdate): Promise<void> {
    this.updateQueue.push(update);

    if (!this.processing) {
      await this.processQueue();
    }
  }

  /**
   * Send custom event to all clients
   */
  async sendCustom(event: string, data?: any): Promise<void> {
    const payload: HMRPayload = {
      type: 'custom',
      data: { event, ...data },
    };

    for (const ws of this.connections) {
      this.send(ws, payload);
    }
  }

  /**
   * Process update queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.updateQueue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      while (this.updateQueue.length > 0) {
        const updates = this.updateQueue.splice(0, this.updateQueue.length);

        const payload: HMRPayload = {
          type: updates[0].type,
          updates,
        };

        // Send to all connected clients
        for (const ws of this.connections) {
          this.send(ws, payload);
        }

        // Small delay to batch updates
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Send message to WebSocket
   */
  private send(ws: WebSocket, payload: HMRPayload): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Find HMR boundary for affected modules
   */
  private findBoundary(affected: Set<ModuleNode>): ModuleNode | null {
    for (const mod of affected) {
      // Check if module accepts its own updates
      if (mod.isSelfAccepting) {
        return mod;
      }

      // Check if module has HMR boundary
      if (mod.acceptedHmr) {
        return mod;
      }

      // Check if module is in configured boundaries
      if (this.config.boundaries?.includes(mod.id)) {
        return mod;
      }

      // Aether components are boundaries by default
      if (this.isAetherComponent(mod)) {
        return mod;
      }
    }

    return null;
  }

  /**
   * Check if module is an Aether component
   */
  private isAetherComponent(mod: ModuleNode): boolean {
    // Check file extension and component patterns
    return (
      mod.type === 'component' ||
      mod.file.endsWith('.tsx') ||
      mod.file.endsWith('.jsx') ||
      /define(Component|Page|Layout|Island)/.test(mod.file)
    );
  }

  /**
   * Register module in graph
   */
  registerModule(
    id: string,
    file: string,
    type: ModuleNode['type'],
    imports: Set<string>
  ): void {
    let mod = this.moduleGraph.getModuleById(id);

    if (!mod) {
      mod = this.moduleGraph.createModule(id, type);
      mod.file = file;
    }

    this.moduleGraph.updateModuleInfo(mod, imports);
  }

  /**
   * Mark module as accepting HMR
   */
  acceptHMR(id: string, selfAccepting = false): void {
    const mod = this.moduleGraph.getModuleById(id);

    if (mod) {
      mod.acceptedHmr = true;
      mod.isSelfAccepting = selfAccepting;
    }
  }

  /**
   * Get module graph
   */
  getModuleGraph(): ModuleGraph {
    return this.moduleGraph;
  }

  /**
   * Close HMR engine
   */
  close(): void {
    // Close all WebSocket connections
    for (const ws of this.connections) {
      ws.close();
    }

    this.connections.clear();
  }
}
