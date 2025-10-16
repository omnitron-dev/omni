/**
 * Flow Service
 *
 * Handles Flow CRUD operations and business logic
 */

import { signal } from '@omnitron-dev/aether';
import type { FlowDefinition, FlowNode, FlowConnection } from '../../../../../../../shared/types/flow';

// Simplified Injectable decorator (Aether placeholder)
export function Injectable(options?: { scope?: string }) {
  return function (target: any) {
    target.__injectable__ = true;
    target.__scope__ = options?.scope || 'module';
    return target;
  };
}

// Simplified inject function (Aether placeholder)
export function inject<T>(token: any): T {
  // Placeholder - in real implementation this would get from DI container
  if (token.__instance__) {
    return token.__instance__;
  }
  const instance = new token();
  token.__instance__ = instance;
  return instance;
}

@Injectable({ scope: 'module' })
export class FlowService {
  private flows = signal<FlowDefinition[]>([]);

  /**
   * Load all flows from storage
   */
  async loadFlows(): Promise<FlowDefinition[]> {
    try {
      const stored = localStorage.getItem('omnitron:flows');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert date strings back to Date objects
        const flows = parsed.map((f: any) => ({
          ...f,
          metadata: {
            ...f.metadata,
            created: new Date(f.metadata.created),
            modified: new Date(f.metadata.modified),
          },
        }));
        this.flows.set(flows);
        return flows;
      }
      return [];
    } catch (error) {
      console.error('Failed to load flows:', error);
      return [];
    }
  }

  /**
   * Create a new flow
   */
  async createFlow(name: string): Promise<FlowDefinition> {
    const flow: FlowDefinition = {
      id: crypto.randomUUID(),
      metadata: {
        name,
        version: '1.0.0',
        description: '',
        author: 'User',
        created: new Date(),
        modified: new Date(),
        tags: [],
      },
      nodes: [],
      connections: [],
    };

    this.flows.update((flows) => [...flows, flow]);
    await this.saveFlows();

    return flow;
  }

  /**
   * Update an existing flow
   */
  async updateFlow(id: string, updates: Partial<FlowDefinition>): Promise<FlowDefinition> {
    this.flows.update((flows) =>
      flows.map((f) =>
        f.id === id
          ? {
              ...f,
              ...updates,
              metadata: {
                ...f.metadata,
                ...(updates.metadata || {}),
                modified: new Date(),
              },
            }
          : f
      )
    );

    await this.saveFlows();
    const flow = this.flows().find((f) => f.id === id);
    if (!flow) {
      throw new Error(`Flow ${id} not found`);
    }
    return flow;
  }

  /**
   * Delete a flow
   */
  async deleteFlow(id: string): Promise<void> {
    this.flows.update((flows) => flows.filter((f) => f.id !== id));
    await this.saveFlows();
  }

  /**
   * Get a single flow by ID
   */
  getFlow(id: string): FlowDefinition | undefined {
    return this.flows().find((f) => f.id === id);
  }

  /**
   * Get all flows
   */
  getFlows(): FlowDefinition[] {
    return this.flows();
  }

  /**
   * Add a node to a flow
   */
  async addNode(flowId: string, node: FlowNode): Promise<void> {
    this.flows.update((flows) =>
      flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              nodes: [...f.nodes, node],
              metadata: { ...f.metadata, modified: new Date() },
            }
          : f
      )
    );
    await this.saveFlows();
  }

  /**
   * Update a node in a flow
   */
  async updateNode(flowId: string, nodeId: string, updates: Partial<FlowNode>): Promise<void> {
    this.flows.update((flows) =>
      flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
              metadata: { ...f.metadata, modified: new Date() },
            }
          : f
      )
    );
    await this.saveFlows();
  }

  /**
   * Remove a node from a flow
   */
  async removeNode(flowId: string, nodeId: string): Promise<void> {
    this.flows.update((flows) =>
      flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              nodes: f.nodes.filter((n) => n.id !== nodeId),
              connections: f.connections.filter((c) => c.from.nodeId !== nodeId && c.to.nodeId !== nodeId),
              metadata: { ...f.metadata, modified: new Date() },
            }
          : f
      )
    );
    await this.saveFlows();
  }

  /**
   * Add a connection between nodes
   */
  async addConnection(flowId: string, connection: FlowConnection): Promise<void> {
    this.flows.update((flows) =>
      flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              connections: [...f.connections, connection],
              metadata: { ...f.metadata, modified: new Date() },
            }
          : f
      )
    );
    await this.saveFlows();
  }

  /**
   * Remove a connection
   */
  async removeConnection(flowId: string, connectionId: string): Promise<void> {
    this.flows.update((flows) =>
      flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              connections: f.connections.filter((c) => c.id !== connectionId),
              metadata: { ...f.metadata, modified: new Date() },
            }
          : f
      )
    );
    await this.saveFlows();
  }

  /**
   * Save flows to storage
   */
  private async saveFlows(): Promise<void> {
    try {
      localStorage.setItem('omnitron:flows', JSON.stringify(this.flows()));
    } catch (error) {
      console.error('Failed to save flows:', error);
      throw error;
    }
  }
}
