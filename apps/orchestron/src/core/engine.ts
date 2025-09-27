import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  Node,
  Edge,
  Branch,
  NodeId,
  EdgeId,
  BranchName,
  Author,
  DevelopmentNodeType,
  DevelopmentEdgeType,
  CommitRequest,
  CommitResponse,
  BranchRequest,
  BranchResponse,
  MergeRequest,
  MergeResponse,
  MergeStrategy,
  BlameResponse,
  DiffResponse,
  FileChange,
  DevelopmentMetrics,
  ErrorPattern,
  DevelopmentMetadata,
  TaskStatus,
} from './types.js';
import { Storage } from '../storage/interface.js';

export interface OrchestronEngineEvents {
  'commit': (response: CommitResponse) => void;
  'branch:created': (branch: Branch) => void;
  'branch:switched': (branch: Branch) => void;
  'merge:completed': (response: MergeResponse) => void;
  'error': (error: Error) => void;
}

export class OrchestronEngine extends EventEmitter<OrchestronEngineEvents> {
  private storage: Storage;
  private currentBranch: BranchName = 'main';
  private sessionId: string;

  constructor(storage: Storage) {
    super();
    this.storage = storage;
    this.sessionId = uuidv4();
  }

  async ensureInitialized(): Promise<void> {
    await this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.storage.initialize();

    const mainBranch = await this.storage.getBranch('main');
    if (!mainBranch) {
      const rootNode: Node = {
        nodeId: uuidv4(),
        author: Author.SYSTEM,
        timestamp: new Date(),
        parentIds: [],
        nodeType: DevelopmentNodeType.ARCHITECTURE,
        payload: {
          title: 'Aletheia AGI System Root',
          description: 'Initial system architecture',
        },
        metadata: {},
      };

      await this.storage.saveNode(rootNode);
      await this.storage.saveBranch({
        name: 'main',
        headNodeId: rootNode.nodeId,
        createdAt: new Date(),
        description: 'Main development branch',
      });
    }
  }

  async commit(request: CommitRequest): Promise<CommitResponse> {
    try {
      const branch = await this.storage.getBranch(this.currentBranch);
      if (!branch) {
        throw new Error(`Branch ${this.currentBranch} not found`);
      }

      const nodeIds: NodeId[] = [];
      const edgeIds: EdgeId[] = [];
      const timestamp = new Date();

      for (const nodeData of request.nodes) {
        const node: Node = {
          ...nodeData,
          nodeId: nodeData.nodeId || uuidv4(),
          timestamp,
          parentIds: nodeData.parentIds.length > 0
            ? nodeData.parentIds
            : [branch.headNodeId],
        };

        await this.storage.saveNode(node);
        nodeIds.push(node.nodeId);
      }

      for (const edgeData of request.edges) {
        const edge: Edge = {
          ...edgeData,
          edgeId: uuidv4(),
        };

        await this.storage.saveEdge(edge);
        edgeIds.push(edge.edgeId);
      }

      if (nodeIds.length > 0) {
        branch.headNodeId = nodeIds[nodeIds.length - 1];
        await this.storage.saveBranch(branch);
      }

      const response: CommitResponse = {
        success: true,
        commitId: nodeIds[nodeIds.length - 1] || branch.headNodeId,
        nodeIds,
        edgeIds,
      };

      this.emit('commit', response);
      return response;

    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  async branch(request: BranchRequest): Promise<BranchResponse> {
    try {
      const fromNodeId = request.fromNodeId ||
        (await this.storage.getBranch(this.currentBranch))?.headNodeId;

      if (!fromNodeId) {
        throw new Error('No valid node to branch from');
      }

      const newBranch: Branch = {
        name: request.name,
        headNodeId: fromNodeId,
        createdAt: new Date(),
        description: request.description,
      };

      await this.storage.saveBranch(newBranch);
      this.emit('branch:created', newBranch);

      return {
        success: true,
        branch: newBranch,
      };

    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  async checkout(branchName: BranchName): Promise<void> {
    const branch = await this.storage.getBranch(branchName);
    if (!branch) {
      throw new Error(`Branch ${branchName} not found`);
    }

    this.currentBranch = branchName;
    this.emit('branch:switched', branch);
  }

  async merge(request: MergeRequest): Promise<MergeResponse> {
    try {
      const fromBranch = await this.storage.getBranch(request.fromBranch);
      const intoBranch = await this.storage.getBranch(request.intoBranch);

      if (!fromBranch || !intoBranch) {
        throw new Error('Invalid branch names');
      }

      switch (request.strategy) {
        case MergeStrategy.FAST_FORWARD:
          intoBranch.headNodeId = fromBranch.headNodeId;
          await this.storage.saveBranch(intoBranch);
          break;

        case MergeStrategy.RECURSIVE:
          const mergeNode: Node = {
            nodeId: uuidv4(),
            author: Author.SYSTEM,
            timestamp: new Date(),
            parentIds: [fromBranch.headNodeId, intoBranch.headNodeId],
            nodeType: DevelopmentNodeType.INTEGRATION,
            payload: {
              message: request.message || `Merge ${request.fromBranch} into ${request.intoBranch}`,
              fromBranch: request.fromBranch,
              intoBranch: request.intoBranch,
            },
            metadata: {},
          };

          await this.storage.saveNode(mergeNode);
          intoBranch.headNodeId = mergeNode.nodeId;
          await this.storage.saveBranch(intoBranch);
          break;

        case MergeStrategy.SQUASH:
          const fromPath = await this.getPathBetween(intoBranch.headNodeId, fromBranch.headNodeId);
          const squashNode: Node = {
            nodeId: uuidv4(),
            author: Author.SYSTEM,
            timestamp: new Date(),
            parentIds: [intoBranch.headNodeId],
            nodeType: DevelopmentNodeType.INTEGRATION,
            payload: {
              message: request.message || `Squash merge ${request.fromBranch}`,
              squashedNodes: fromPath.map(n => n.nodeId),
            },
            metadata: this.aggregateMetadata(fromPath),
          };

          await this.storage.saveNode(squashNode);
          intoBranch.headNodeId = squashNode.nodeId;
          await this.storage.saveBranch(intoBranch);
          break;
      }

      const response: MergeResponse = {
        success: true,
        mergeNodeId: intoBranch.headNodeId,
      };

      this.emit('merge:completed', response);
      return response;

    } catch (error) {
      this.emit('error', error as Error);
      throw error;
    }
  }

  async blame(nodeId: NodeId): Promise<BlameResponse> {
    const visited = new Set<NodeId>();
    const path: Node[] = [];
    const edges: Edge[] = [];
    const queue: NodeId[] = [nodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = await this.storage.getNode(currentId);
      if (!node) continue;

      path.push(node);

      const incomingEdges = await this.storage.getIncomingEdges(currentId);
      edges.push(...incomingEdges);

      for (const edge of incomingEdges) {
        if (!visited.has(edge.sourceNodeId)) {
          queue.push(edge.sourceNodeId);
        }
      }

      for (const parentId of node.parentIds) {
        if (!visited.has(parentId)) {
          queue.push(parentId);
        }
      }
    }

    return {
      path: path.reverse(),
      edges,
      depth: path.length,
    };
  }

  async diff(fromRef: NodeId, toRef: NodeId): Promise<DiffResponse> {
    const fromSubgraph = await this.getSubgraph(fromRef);
    const toSubgraph = await this.getSubgraph(toRef);

    const fromNodeIds = new Set(fromSubgraph.nodes.map(n => n.nodeId));
    const toNodeIds = new Set(toSubgraph.nodes.map(n => n.nodeId));

    const addedNodes = toSubgraph.nodes.filter(n => !fromNodeIds.has(n.nodeId));
    const removedNodes = fromSubgraph.nodes.filter(n => !toNodeIds.has(n.nodeId));

    const modifiedNodes: Array<{ before: Node; after: Node }> = [];
    for (const node of toSubgraph.nodes) {
      if (fromNodeIds.has(node.nodeId)) {
        const beforeNode = fromSubgraph.nodes.find(n => n.nodeId === node.nodeId);
        if (beforeNode && JSON.stringify(beforeNode) !== JSON.stringify(node)) {
          modifiedNodes.push({ before: beforeNode, after: node });
        }
      }
    }

    const fromEdgeIds = new Set(fromSubgraph.edges.map(e => e.edgeId));
    const toEdgeIds = new Set(toSubgraph.edges.map(e => e.edgeId));

    const addedEdges = toSubgraph.edges.filter(e => !fromEdgeIds.has(e.edgeId));
    const removedEdges = fromSubgraph.edges.filter(e => !toEdgeIds.has(e.edgeId));

    return {
      addedNodes,
      removedNodes,
      modifiedNodes,
      addedEdges,
      removedEdges,
    };
  }

  async commitCode(params: {
    type: DevelopmentNodeType;
    files: FileChange[];
    message: string;
    metrics?: DevelopmentMetadata;
  }): Promise<CommitResponse> {
    const nodes = [{
      author: Author.HUMAN,
      parentIds: [],
      nodeType: params.type,
      payload: {
        message: params.message,
        files: params.files.map(f => ({
          path: f.path,
          action: f.action,
          diff: f.diff,
        })),
      },
      metadata: {
        ...params.metrics,
        filesModified: params.files.map(f => f.path),
        linesAdded: params.files.reduce((sum, f) => {
          if (f.diff) {
            const added = (f.diff.match(/^\+/gm) || []).length;
            return sum + added;
          }
          return sum;
        }, 0),
        linesRemoved: params.files.reduce((sum, f) => {
          if (f.diff) {
            const removed = (f.diff.match(/^-/gm) || []).length;
            return sum + removed;
          }
          return sum;
        }, 0),
      },
    }];

    return this.commit({ nodes: nodes as any, edges: [], message: params.message });
  }

  async logError(params: {
    message: string;
    component: string;
    severity: string;
    stack?: string;
  }): Promise<CommitResponse> {
    const errorNode = {
      author: Author.SYSTEM,
      parentIds: [],
      nodeType: DevelopmentNodeType.ERROR,
      payload: {
        message: params.message,
        component: params.component,
        severity: params.severity,
        stack: params.stack,
        timestamp: new Date(),
      },
      metadata: {
        component: params.component,
        severity: params.severity,
      },
    };

    return this.commit({
      nodes: [errorNode as any],
      edges: [],
      message: `Error: ${params.message}`
    });
  }

  async experiment(name: string, hypothesis: string): Promise<BranchResponse> {
    const experimentNode: Node = {
      nodeId: uuidv4(),
      author: Author.HUMAN,
      timestamp: new Date(),
      parentIds: [],
      nodeType: DevelopmentNodeType.EXPERIMENT,
      payload: {
        hypothesis,
        startTime: new Date(),
      },
      metadata: {
        status: TaskStatus.IN_PROGRESS,
      },
    };

    await this.commit({
      nodes: [experimentNode],
      edges: [],
      message: `Start experiment: ${hypothesis}`,
    });

    return this.branch({
      name: `experiment/${name}`,
      description: hypothesis,
    });
  }

  async queryComponent(componentPath: string): Promise<Node[]> {
    const allNodes = await this.storage.getAllNodes();
    return allNodes.filter(node => {
      const files = node.metadata.filesModified || [];
      return files.some(f => f.includes(componentPath));
    });
  }

  async getMetrics(from: Date, to: Date): Promise<DevelopmentMetrics> {
    const nodes = await this.storage.getNodesByTimeRange(from, to);
    const edges = await this.storage.getAllEdges();
    const branches = await this.storage.getAllBranches();

    const nodesByType: Record<DevelopmentNodeType, number> = {} as any;
    const edgesByType: Record<DevelopmentEdgeType, number> = {} as any;

    for (const node of nodes) {
      nodesByType[node.nodeType] = (nodesByType[node.nodeType] || 0) + 1;
    }

    for (const edge of edges) {
      edgesByType[edge.edgeType] = (edgesByType[edge.edgeType] || 0) + 1;
    }

    const errors = nodes.filter(n => n.nodeType === DevelopmentNodeType.ERROR);
    const errorRate = nodes.length > 0 ? errors.length / nodes.length : 0;

    const complexities = nodes
      .map(n => n.metadata.complexity)
      .filter((c): c is number => c !== undefined);
    const averageComplexity = complexities.length > 0
      ? complexities.reduce((a, b) => a + b, 0) / complexities.length
      : 0;

    const coverages = nodes
      .map(n => n.metadata.testCoverage)
      .filter((c): c is number => c !== undefined);
    const testCoverage = coverages.length > 0
      ? Math.max(...coverages)
      : 0;

    const benchmarks = nodes.filter(n => n.nodeType === DevelopmentNodeType.BENCHMARK);
    let performanceImprovement = 0;
    if (benchmarks.length >= 2) {
      const first = benchmarks[0].payload.throughput || 0;
      const last = benchmarks[benchmarks.length - 1].payload.throughput || 0;
      performanceImprovement = first > 0 ? (last - first) / first : 0;
    }

    // Calculate task metrics
    const taskNodes = nodes.filter(n =>
      n.nodeType === DevelopmentNodeType.TASK ||
      n.nodeType === DevelopmentNodeType.SUBTASK ||
      n.nodeType === DevelopmentNodeType.TODO
    );
    const tasksCompleted = taskNodes.filter(n => n.metadata.status === TaskStatus.DONE).length;
    const tasksInProgress = taskNodes.filter(n => n.metadata.status === TaskStatus.IN_PROGRESS).length;
    const tasksBlocked = taskNodes.filter(n => n.metadata.status === TaskStatus.BLOCKED).length;

    // Calculate average cycle time
    const completedTasks = taskNodes.filter(n => n.metadata.status === TaskStatus.DONE && n.metadata.timeSpent);
    const avgCycleTime = completedTasks.length > 0
      ? completedTasks.reduce((sum, t) => sum + (t.metadata.timeSpent || 0), 0) / completedTasks.length
      : 0;

    return {
      totalNodes: nodes.length,
      nodesByType,
      totalEdges: edges.length,
      edgesByType,
      activeBranches: branches.length,
      errorRate,
      averageComplexity,
      testCoverage,
      performanceImprovement,
      // Task metrics
      totalTasks: taskNodes.length,
      tasksCompleted,
      tasksInProgress,
      tasksBlocked,
      averageCycleTime: avgCycleTime,
      // Sprint metrics (placeholders)
      sprintVelocity: 0,
      sprintProgress: 0,
      predictedCompletion: null,
    };
  }

  async analyzeErrors(threshold: number = 2): Promise<ErrorPattern[]> {
    const errorNodes = (await this.storage.getAllNodes())
      .filter(n => n.nodeType === DevelopmentNodeType.ERROR);

    const patterns = new Map<string, ErrorPattern>();

    for (const error of errorNodes) {
      const message = error.payload.message || error.payload.description || '';
      const pattern = this.extractErrorPattern(message);

      if (!patterns.has(pattern)) {
        patterns.set(pattern, {
          pattern,
          frequency: 0,
          lastOccurrence: error.timestamp,
          relatedNodes: [],
        });
      }

      const errorPattern = patterns.get(pattern)!;
      errorPattern.frequency++;
      errorPattern.relatedNodes.push(error.nodeId);
      if (error.timestamp > errorPattern.lastOccurrence) {
        errorPattern.lastOccurrence = error.timestamp;
      }
    }

    return Array.from(patterns.values())
      .filter(p => p.frequency >= threshold)
      .sort((a, b) => b.frequency - a.frequency);
  }

  async generateReport(format: 'markdown' | 'json'): Promise<string> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const metrics = await this.getMetrics(dayAgo, now);
    const errors = await this.analyzeErrors();
    const branches = await this.storage.getAllBranches();

    if (format === 'json') {
      return JSON.stringify({
        timestamp: now,
        metrics,
        errors,
        branches: branches.map(b => b.name),
      }, null, 2);
    }

    return `# Development Report
Generated: ${now.toISOString()}

## Metrics (Last 24 Hours)
- Total Nodes: ${metrics.totalNodes}
- Total Edges: ${metrics.totalEdges}
- Active Branches: ${metrics.activeBranches}
- Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%
- Average Complexity: ${metrics.averageComplexity.toFixed(2)}
- Test Coverage: ${(metrics.testCoverage * 100).toFixed(2)}%
- Performance Improvement: ${(metrics.performanceImprovement * 100).toFixed(2)}%

## Node Distribution
${Object.entries(metrics.nodesByType)
  .map(([type, count]) => `- ${type}: ${count}`)
  .join('\n')}

## Error Patterns
${errors.slice(0, 5)
  .map(e => `- **${e.pattern}** (${e.frequency} occurrences)`)
  .join('\n')}

## Active Branches
${branches.map(b => `- ${b.name} (HEAD: ${b.headNodeId.slice(0, 8)})`).join('\n')}
`;
  }

  private async getSubgraph(nodeId: NodeId): Promise<{ nodes: Node[]; edges: Edge[] }> {
    const blame = await this.blame(nodeId);
    return {
      nodes: blame.path,
      edges: blame.edges,
    };
  }

  private async getPathBetween(fromId: NodeId, toId: NodeId): Promise<Node[]> {
    const visited = new Set<NodeId>();
    const path: Node[] = [];
    let currentId = toId;

    while (currentId !== fromId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = await this.storage.getNode(currentId);
      if (!node) break;

      path.push(node);
      if (node.parentIds.length > 0) {
        currentId = node.parentIds[0];
      } else {
        break;
      }
    }

    return path;
  }

  private aggregateMetadata(nodes: Node[]): DevelopmentMetadata {
    const metadata: DevelopmentMetadata = {};

    for (const node of nodes) {
      if (node.metadata.linesAdded) {
        metadata.linesAdded = (metadata.linesAdded || 0) + node.metadata.linesAdded;
      }
      if (node.metadata.linesRemoved) {
        metadata.linesRemoved = (metadata.linesRemoved || 0) + node.metadata.linesRemoved;
      }
    }

    return metadata;
  }

  private extractErrorPattern(message: string): string {
    return message
      .replace(/0x[0-9a-fA-F]+/g, '0xADDR')
      .replace(/\d+/g, 'NUM')
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'UUID')
      .toLowerCase()
      .trim();
  }

  getCurrentBranch(): BranchName {
    return this.currentBranch;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  // ============= Query Methods =============

  async getAllNodes(): Promise<Node[]> {
    return this.storage.getAllNodes();
  }

  async getAllEdges(): Promise<Edge[]> {
    return this.storage.getAllEdges();
  }

  async getNode(nodeId: NodeId): Promise<Node | null> {
    return this.storage.getNode(nodeId);
  }

  async queryByType(nodeType: DevelopmentNodeType): Promise<Node[]> {
    const nodes = await this.storage.getAllNodes();
    return nodes.filter(n => n.nodeType === nodeType);
  }

  async queryByMetadata(metadata: Partial<DevelopmentMetadata>): Promise<Node[]> {
    const nodes = await this.storage.getAllNodes();
    return nodes.filter(node => {
      for (const [key, value] of Object.entries(metadata)) {
        const nodeValue = node.metadata[key as keyof DevelopmentMetadata];

        // Handle array comparison
        if (Array.isArray(value) && Array.isArray(nodeValue)) {
          // Check if all elements in the search array are in the node's array
          const searchArray = value as string[];
          const nodeArray = nodeValue as string[];
          const hasAll = searchArray.every(item => nodeArray.includes(item));
          if (!hasAll) return false;
        } else if (nodeValue !== value) {
          return false;
        }
      }
      return true;
    });
  }

  async search(query: string, options?: any): Promise<Node[]> {
    const nodes = await this.storage.getAllNodes();
    const lowerQuery = query.toLowerCase();

    return nodes.filter(node => {
      // Search in payload
      const payloadStr = JSON.stringify(node.payload).toLowerCase();
      if (payloadStr.includes(lowerQuery)) return true;

      // Search in metadata
      const metadataStr = JSON.stringify(node.metadata).toLowerCase();
      if (metadataStr.includes(lowerQuery)) return true;

      // Search in node type
      if (node.nodeType.includes(lowerQuery)) return true;

      return false;
    });
  }

  async getRecentNodes(limit: number): Promise<Node[]> {
    const nodes = await this.storage.getAllNodes();
    return nodes
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getEdgesByTarget(targetNodeId: NodeId): Promise<Edge[]> {
    return this.storage.getIncomingEdges(targetNodeId);
  }

  async getEdgesBySource(sourceNodeId: NodeId): Promise<Edge[]> {
    return this.storage.getOutgoingEdges(sourceNodeId);
  }

  async checkoutBranch(branchName: BranchName): Promise<void> {
    return this.checkout(branchName);
  }

  async close(): Promise<void> {
    // Clean up resources if needed
    this.removeAllListeners();
  }
}