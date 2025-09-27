import Database from 'better-sqlite3';
import {
  Node,
  Edge,
  Branch,
  NodeId,
  EdgeId,
  BranchName,
} from '../core/types.js';
import { Storage } from './interface.js';

export class SQLiteStorage implements Storage {
  private db: Database.Database;

  constructor(filepath: string = ':memory:') {
    this.db = new Database(filepath);
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        node_id TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        parent_ids TEXT NOT NULL,
        node_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        metadata TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        edge_id TEXT PRIMARY KEY,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        edge_type TEXT NOT NULL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS branches (
        name TEXT PRIMARY KEY,
        head_node_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        description TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_timestamp ON nodes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id);

      -- Phase 1: Enhanced indexes for task and sprint management
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);
      CREATE INDEX IF NOT EXISTS idx_nodes_type_timestamp ON nodes(node_type, timestamp);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);

      -- Additional tables for Phase 1 features
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        node_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        assignee TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration INTEGER,
        description TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_assignee ON time_entries(assignee);
    `);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async saveNode(node: Node): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO nodes (
        node_id, author, timestamp, parent_ids, node_type, payload, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      node.nodeId,
      node.author,
      node.timestamp.getTime(),
      JSON.stringify(node.parentIds),
      node.nodeType,
      JSON.stringify(node.payload),
      JSON.stringify(node.metadata)
    );
  }

  async getNode(nodeId: NodeId): Promise<Node | null> {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE node_id = ?');
    const row = stmt.get(nodeId) as any;

    if (!row) return null;

    return {
      nodeId: row.node_id,
      author: row.author,
      timestamp: new Date(row.timestamp),
      parentIds: JSON.parse(row.parent_ids),
      nodeType: row.node_type,
      payload: JSON.parse(row.payload),
      metadata: JSON.parse(row.metadata),
    };
  }

  async getAllNodes(): Promise<Node[]> {
    const stmt = this.db.prepare('SELECT * FROM nodes ORDER BY timestamp ASC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      nodeId: row.node_id,
      author: row.author,
      timestamp: new Date(row.timestamp),
      parentIds: JSON.parse(row.parent_ids),
      nodeType: row.node_type,
      payload: JSON.parse(row.payload),
      metadata: JSON.parse(row.metadata),
    }));
  }

  async getNodesByTimeRange(from: Date, to: Date): Promise<Node[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM nodes
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);
    const rows = stmt.all(from.getTime(), to.getTime()) as any[];

    return rows.map(row => ({
      nodeId: row.node_id,
      author: row.author,
      timestamp: new Date(row.timestamp),
      parentIds: JSON.parse(row.parent_ids),
      nodeType: row.node_type,
      payload: JSON.parse(row.payload),
      metadata: JSON.parse(row.metadata),
    }));
  }

  async saveEdge(edge: Edge): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO edges (
        edge_id, source_node_id, target_node_id, edge_type, metadata
      ) VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      edge.edgeId,
      edge.sourceNodeId,
      edge.targetNodeId,
      edge.edgeType,
      JSON.stringify(edge.metadata || {})
    );
  }

  async getEdge(edgeId: EdgeId): Promise<Edge | null> {
    const stmt = this.db.prepare('SELECT * FROM edges WHERE edge_id = ?');
    const row = stmt.get(edgeId) as any;

    if (!row) return null;

    return {
      edgeId: row.edge_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      edgeType: row.edge_type,
      metadata: JSON.parse(row.metadata),
    };
  }

  async getAllEdges(): Promise<Edge[]> {
    const stmt = this.db.prepare('SELECT * FROM edges');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      edgeId: row.edge_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      edgeType: row.edge_type,
      metadata: JSON.parse(row.metadata),
    }));
  }

  async getOutgoingEdges(nodeId: NodeId): Promise<Edge[]> {
    const stmt = this.db.prepare('SELECT * FROM edges WHERE source_node_id = ?');
    const rows = stmt.all(nodeId) as any[];

    return rows.map(row => ({
      edgeId: row.edge_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      edgeType: row.edge_type,
      metadata: JSON.parse(row.metadata),
    }));
  }

  async getIncomingEdges(nodeId: NodeId): Promise<Edge[]> {
    const stmt = this.db.prepare('SELECT * FROM edges WHERE target_node_id = ?');
    const rows = stmt.all(nodeId) as any[];

    return rows.map(row => ({
      edgeId: row.edge_id,
      sourceNodeId: row.source_node_id,
      targetNodeId: row.target_node_id,
      edgeType: row.edge_type,
      metadata: JSON.parse(row.metadata),
    }));
  }

  async saveBranch(branch: Branch): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO branches (
        name, head_node_id, created_at, description
      ) VALUES (?, ?, ?, ?)
    `);

    stmt.run(
      branch.name,
      branch.headNodeId,
      branch.createdAt.getTime(),
      branch.description || null
    );
  }

  async getBranch(name: BranchName): Promise<Branch | null> {
    const stmt = this.db.prepare('SELECT * FROM branches WHERE name = ?');
    const row = stmt.get(name) as any;

    if (!row) return null;

    return {
      name: row.name,
      headNodeId: row.head_node_id,
      createdAt: new Date(row.created_at),
      description: row.description,
    };
  }

  async getAllBranches(): Promise<Branch[]> {
    const stmt = this.db.prepare('SELECT * FROM branches ORDER BY created_at ASC');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      name: row.name,
      headNodeId: row.head_node_id,
      createdAt: new Date(row.created_at),
      description: row.description,
    }));
  }

  async deleteBranch(name: BranchName): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM branches WHERE name = ?');
    stmt.run(name);
  }

  async clear(): Promise<void> {
    this.db.exec('DELETE FROM nodes');
    this.db.exec('DELETE FROM edges');
    this.db.exec('DELETE FROM branches');
  }

  // Extended storage methods for compatibility
  async getData(key: string): Promise<any> {
    try {
      // Try to get from nodes table first
      const stmt = this.db.prepare('SELECT payload FROM nodes WHERE nodeId = ? LIMIT 1');
      const row = stmt.get(key) as any;
      if (row) {
        return JSON.parse(row.payload);
      }
      return null;
    } catch (error) {
      console.error('Error getting data:', error);
      return null;
    }
  }

  async saveData(key: string, data: any): Promise<void> {
    try {
      // Save as a special node for now
      const node: Node = {
        nodeId: key,
        author: 'SYSTEM' as any,
        parentIds: [],
        nodeType: 'DATA' as any,
        payload: data,
        metadata: {},
        timestamp: new Date()
      };
      await this.saveNode(node);
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }

  async createNode(partialNode: Partial<Node>): Promise<Node> {
    const node: Node = {
      nodeId: partialNode.nodeId || `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      author: partialNode.author || 'SYSTEM' as any,
      parentIds: partialNode.parentIds || [],
      nodeType: partialNode.nodeType || 'GENERIC' as any,
      payload: partialNode.payload || {},
      metadata: partialNode.metadata || {},
      timestamp: partialNode.timestamp || new Date()
    };
    await this.saveNode(node);
    return node;
  }

  async queryNodes(query: any): Promise<Node[]> {
    try {
      let sql = 'SELECT * FROM nodes WHERE 1=1';
      const params: any[] = [];

      if (query.nodeType) {
        sql += ' AND node_type = ?';
        params.push(query.nodeType);
      }

      if (query.author) {
        sql += ' AND author = ?';
        params.push(query.author);
      }

      if (query.after) {
        sql += ' AND created_at > ?';
        params.push(new Date(query.after).getTime());
      }

      if (query.before) {
        sql += ' AND created_at < ?';
        params.push(new Date(query.before).getTime());
      }

      sql += ' ORDER BY created_at DESC';

      if (query.limit) {
        sql += ' LIMIT ?';
        params.push(query.limit);
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      return rows.map(row => ({
        nodeId: row.id,
        author: row.author,
        parentIds: JSON.parse(row.parent_ids),
        nodeType: row.node_type,
        payload: JSON.parse(row.payload),
        metadata: JSON.parse(row.metadata),
        timestamp: new Date(row.created_at)
      } as Node));
    } catch (error) {
      console.error('Error querying nodes:', error);
      return [];
    }
  }
}