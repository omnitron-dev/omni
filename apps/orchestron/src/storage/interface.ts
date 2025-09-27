import {
  Node,
  Edge,
  Branch,
  NodeId,
  EdgeId,
  BranchName,
} from '../core/types.js';

export interface Storage {
  initialize(): Promise<void>;
  close(): Promise<void>;

  saveNode(node: Node): Promise<void>;
  getNode(nodeId: NodeId): Promise<Node | null>;
  getAllNodes(): Promise<Node[]>;
  getNodesByTimeRange(from: Date, to: Date): Promise<Node[]>;

  saveEdge(edge: Edge): Promise<void>;
  getEdge(edgeId: EdgeId): Promise<Edge | null>;
  getAllEdges(): Promise<Edge[]>;
  getOutgoingEdges(nodeId: NodeId): Promise<Edge[]>;
  getIncomingEdges(nodeId: NodeId): Promise<Edge[]>;

  saveBranch(branch: Branch): Promise<void>;
  getBranch(name: BranchName): Promise<Branch | null>;
  getAllBranches(): Promise<Branch[]>;
  deleteBranch(name: BranchName): Promise<void>;

  clear(): Promise<void>;

  // Additional methods for extended storage operations
  getData?(key: string): Promise<any>;
  saveData?(key: string, data: any): Promise<void>;
  createNode?(node: Partial<Node>): Promise<Node>;
  queryNodes?(query: any): Promise<Node[]>;
}