import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteStorage } from '../../src/storage/sqlite';
import { v4 as uuidv4 } from 'uuid';
import {
  Node,
  Edge,
  Branch,
  Author,
  DevelopmentNodeType,
  DevelopmentEdgeType,
} from '../../src/core/types';

describe('SQLiteStorage', () => {
  let storage: SQLiteStorage;

  beforeEach(async () => {
    storage = new SQLiteStorage(':memory:');
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('initialization', () => {
    it('should initialize with in-memory database', async () => {
      expect(storage).toBeDefined();
      // Test that we can interact with the database
      const branches = await storage.getAllBranches();
      expect(branches).toEqual([]);
    });

    it('should create all required tables', async () => {
      // Test by inserting data into each table
      const nodeId = uuidv4();
      const node: Node = {
        nodeId,
        author: Author.HUMAN,
        timestamp: new Date(),
        parentIds: [],
        nodeType: DevelopmentNodeType.FEATURE,
        payload: { test: 'data' },
        metadata: {},
      };

      await storage.saveNode(node);
      const retrieved = await storage.getNode(nodeId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.nodeId).toBe(nodeId);
    });
  });

  describe('Node operations', () => {
    it('should save and retrieve a node', async () => {
      const node: Node = {
        nodeId: uuidv4(),
        author: Author.HUMAN,
        timestamp: new Date(),
        parentIds: ['parent1', 'parent2'],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: 'Test Task', description: 'Description' },
        metadata: { priority: 'high' },
      };

      await storage.saveNode(node);
      const retrieved = await storage.getNode(node.nodeId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.nodeId).toBe(node.nodeId);
      expect(retrieved?.author).toBe(node.author);
      expect(retrieved?.nodeType).toBe(node.nodeType);
      expect(retrieved?.payload).toEqual(node.payload);
      expect(retrieved?.metadata).toEqual(node.metadata);
      expect(retrieved?.parentIds).toEqual(node.parentIds);
    });

    it('should return null for non-existent node', async () => {
      const result = await storage.getNode('non-existent');
      expect(result).toBeNull();
    });

    it('should get all nodes', async () => {
      const nodes: Node[] = [];
      for (let i = 0; i < 3; i++) {
        const node: Node = {
          nodeId: uuidv4(),
          author: Author.HUMAN,
          timestamp: new Date(Date.now() + i * 1000),
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { index: i },
          metadata: {},
        };
        nodes.push(node);
        await storage.saveNode(node);
      }

      const allNodes = await storage.getAllNodes();
      expect(allNodes).toHaveLength(3);
      // Should be ordered by timestamp
      expect(allNodes[0].payload.index).toBe(0);
      expect(allNodes[2].payload.index).toBe(2);
    });

    it('should get nodes by time range', async () => {
      const now = Date.now();
      const nodes = [
        {
          nodeId: uuidv4(),
          author: Author.HUMAN,
          timestamp: new Date(now - 3600000), // 1 hour ago
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { age: 'old' },
          metadata: {},
        },
        {
          nodeId: uuidv4(),
          author: Author.HUMAN,
          timestamp: new Date(now - 1800000), // 30 minutes ago
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { age: 'middle' },
          metadata: {},
        },
        {
          nodeId: uuidv4(),
          author: Author.HUMAN,
          timestamp: new Date(now), // now
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { age: 'new' },
          metadata: {},
        },
      ];

      for (const node of nodes) {
        await storage.saveNode(node);
      }

      const rangeNodes = await storage.getNodesByTimeRange(
        new Date(now - 2400000), // 40 minutes ago
        new Date(now + 1000) // just after now
      );

      expect(rangeNodes).toHaveLength(2);
      expect(rangeNodes[0].payload.age).toBe('middle');
      expect(rangeNodes[1].payload.age).toBe('new');
    });

    it('should update existing node', async () => {
      const nodeId = uuidv4();
      const originalNode: Node = {
        nodeId,
        author: Author.HUMAN,
        timestamp: new Date(),
        parentIds: [],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: 'Original' },
        metadata: {},
      };

      await storage.saveNode(originalNode);

      const updatedNode: Node = {
        ...originalNode,
        payload: { title: 'Updated' },
        metadata: { changed: true },
      };

      await storage.saveNode(updatedNode);

      const retrieved = await storage.getNode(nodeId);
      expect(retrieved?.payload.title).toBe('Updated');
      expect(retrieved?.metadata.changed).toBe(true);
    });
  });

  describe('Edge operations', () => {
    it('should save and retrieve an edge', async () => {
      const edge: Edge = {
        edgeId: uuidv4(),
        sourceNodeId: 'source123',
        targetNodeId: 'target456',
        edgeType: DevelopmentEdgeType.IMPLEMENTS,
        metadata: { weight: 1.0 },
      };

      await storage.saveEdge(edge);
      const retrieved = await storage.getEdge(edge.edgeId);

      expect(retrieved).toBeDefined();
      expect(retrieved?.edgeId).toBe(edge.edgeId);
      expect(retrieved?.sourceNodeId).toBe(edge.sourceNodeId);
      expect(retrieved?.targetNodeId).toBe(edge.targetNodeId);
      expect(retrieved?.edgeType).toBe(edge.edgeType);
      expect(retrieved?.metadata).toEqual(edge.metadata);
    });

    it('should return null for non-existent edge', async () => {
      const result = await storage.getEdge('non-existent');
      expect(result).toBeNull();
    });

    it('should get all edges', async () => {
      const edges: Edge[] = [];
      for (let i = 0; i < 3; i++) {
        const edge: Edge = {
          edgeId: uuidv4(),
          sourceNodeId: `source${i}`,
          targetNodeId: `target${i}`,
          edgeType: DevelopmentEdgeType.REQUIRES,
          metadata: { index: i },
        };
        edges.push(edge);
        await storage.saveEdge(edge);
      }

      const allEdges = await storage.getAllEdges();
      expect(allEdges).toHaveLength(3);
    });

    it('should get outgoing edges for a node', async () => {
      const sourceNode = 'source123';
      const edges = [
        {
          edgeId: uuidv4(),
          sourceNodeId: sourceNode,
          targetNodeId: 'target1',
          edgeType: DevelopmentEdgeType.IMPLEMENTS,
        },
        {
          edgeId: uuidv4(),
          sourceNodeId: sourceNode,
          targetNodeId: 'target2',
          edgeType: DevelopmentEdgeType.TESTS,
        },
        {
          edgeId: uuidv4(),
          sourceNodeId: 'otherSource',
          targetNodeId: 'target3',
          edgeType: DevelopmentEdgeType.REQUIRES,
        },
      ];

      for (const edge of edges) {
        await storage.saveEdge(edge);
      }

      const outgoing = await storage.getOutgoingEdges(sourceNode);
      expect(outgoing).toHaveLength(2);
      expect(outgoing.every(e => e.sourceNodeId === sourceNode)).toBe(true);
    });

    it('should get incoming edges for a node', async () => {
      const targetNode = 'target123';
      const edges = [
        {
          edgeId: uuidv4(),
          sourceNodeId: 'source1',
          targetNodeId: targetNode,
          edgeType: DevelopmentEdgeType.IMPLEMENTS,
        },
        {
          edgeId: uuidv4(),
          sourceNodeId: 'source2',
          targetNodeId: targetNode,
          edgeType: DevelopmentEdgeType.TESTS,
        },
        {
          edgeId: uuidv4(),
          sourceNodeId: 'source3',
          targetNodeId: 'otherTarget',
          edgeType: DevelopmentEdgeType.REQUIRES,
        },
      ];

      for (const edge of edges) {
        await storage.saveEdge(edge);
      }

      const incoming = await storage.getIncomingEdges(targetNode);
      expect(incoming).toHaveLength(2);
      expect(incoming.every(e => e.targetNodeId === targetNode)).toBe(true);
    });
  });

  describe('Branch operations', () => {
    it('should save and retrieve a branch', async () => {
      const branch: Branch = {
        name: 'feature-branch',
        headNodeId: uuidv4(),
        createdAt: new Date(),
        description: 'Test branch',
      };

      await storage.saveBranch(branch);
      const retrieved = await storage.getBranch(branch.name);

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe(branch.name);
      expect(retrieved?.headNodeId).toBe(branch.headNodeId);
      expect(retrieved?.description).toBe(branch.description);
      expect(retrieved?.createdAt.getTime()).toBeCloseTo(branch.createdAt.getTime(), -2);
    });

    it('should return null for non-existent branch', async () => {
      const result = await storage.getBranch('non-existent');
      expect(result).toBeNull();
    });

    it('should get all branches', async () => {
      const branches = [
        {
          name: 'main',
          headNodeId: uuidv4(),
          createdAt: new Date(Date.now() - 3600000),
          description: 'Main branch',
        },
        {
          name: 'develop',
          headNodeId: uuidv4(),
          createdAt: new Date(Date.now() - 1800000),
          description: 'Development branch',
        },
        {
          name: 'feature',
          headNodeId: uuidv4(),
          createdAt: new Date(),
          description: 'Feature branch',
        },
      ];

      for (const branch of branches) {
        await storage.saveBranch(branch);
      }

      const allBranches = await storage.getAllBranches();
      expect(allBranches).toHaveLength(3);
      // Should be ordered by creation time
      expect(allBranches[0].name).toBe('main');
      expect(allBranches[2].name).toBe('feature');
    });

    it('should update existing branch', async () => {
      const branch: Branch = {
        name: 'test-branch',
        headNodeId: uuidv4(),
        createdAt: new Date(),
        description: 'Original description',
      };

      await storage.saveBranch(branch);

      const updatedBranch: Branch = {
        ...branch,
        headNodeId: uuidv4(),
        description: 'Updated description',
      };

      await storage.saveBranch(updatedBranch);

      const retrieved = await storage.getBranch(branch.name);
      expect(retrieved?.headNodeId).toBe(updatedBranch.headNodeId);
      expect(retrieved?.description).toBe('Updated description');
    });

    it('should delete a branch', async () => {
      const branch: Branch = {
        name: 'to-delete',
        headNodeId: uuidv4(),
        createdAt: new Date(),
        description: 'Will be deleted',
      };

      await storage.saveBranch(branch);
      const saved = await storage.getBranch(branch.name);
      expect(saved).toBeDefined();

      await storage.deleteBranch(branch.name);
      const deleted = await storage.getBranch(branch.name);
      expect(deleted).toBeNull();
    });
  });

  describe('Clear operations', () => {
    it('should clear all data', async () => {
      // Add some data
      const node: Node = {
        nodeId: uuidv4(),
        author: Author.HUMAN,
        timestamp: new Date(),
        parentIds: [],
        nodeType: DevelopmentNodeType.FEATURE,
        payload: {},
        metadata: {},
      };

      const edge: Edge = {
        edgeId: uuidv4(),
        sourceNodeId: node.nodeId,
        targetNodeId: uuidv4(),
        edgeType: DevelopmentEdgeType.IMPLEMENTS,
      };

      const branch: Branch = {
        name: 'test-branch',
        headNodeId: node.nodeId,
        createdAt: new Date(),
        description: 'Test',
      };

      await storage.saveNode(node);
      await storage.saveEdge(edge);
      await storage.saveBranch(branch);

      // Verify data exists
      expect(await storage.getAllNodes()).toHaveLength(1);
      expect(await storage.getAllEdges()).toHaveLength(1);
      expect(await storage.getAllBranches()).toHaveLength(1);

      // Clear all data
      await storage.clear();

      // Verify data is gone
      expect(await storage.getAllNodes()).toHaveLength(0);
      expect(await storage.getAllEdges()).toHaveLength(0);
      expect(await storage.getAllBranches()).toHaveLength(0);
    });
  });
});