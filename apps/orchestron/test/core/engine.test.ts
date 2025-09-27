import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OrchestronEngine } from '../../src/core/engine';
import {
  createTestContext,
  cleanupTestContext,
  createSampleTask,
  TestContext,
  expectNodeToMatch,
  mockDate,
  assertEventEmitted,
} from '../fixtures/test-helpers';
import {
  Author,
  DevelopmentNodeType,
  DevelopmentEdgeType,
  TaskStatus,
  Priority,
  MergeStrategy,
  Node,
  Edge,
} from '../../src/core/types';

describe('OrchestronEngine', () => {
  let context: TestContext;
  let engine: OrchestronEngine;

  beforeEach(async () => {
    context = await createTestContext();
    engine = context.engine;
  });

  afterEach(async () => {
    await cleanupTestContext(context);
  });

  describe('Initialization', () => {
    it('should initialize with main branch', async () => {
      const mainBranch = await context.storage.getBranch('main');
      expect(mainBranch).toBeTruthy();
      expect(mainBranch?.name).toBe('main');
      expect(mainBranch?.headNodeId).toBeTruthy();
    });

    it('should create root node on initialization', async () => {
      const mainBranch = await context.storage.getBranch('main');
      expect(mainBranch).toBeTruthy();

      const rootNode = await context.storage.getNode(mainBranch!.headNodeId);
      expect(rootNode).toBeTruthy();
      expect(rootNode?.nodeType).toBe(DevelopmentNodeType.ARCHITECTURE);
      expect(rootNode?.author).toBe(Author.SYSTEM);
    });

    it('should have correct session ID', () => {
      const sessionId = engine.getSessionId();
      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it('should have main as current branch', () => {
      expect(engine.getCurrentBranch()).toBe('main');
    });
  });

  describe('Node Operations', () => {
    it('should commit single node successfully', async () => {
      const nodeData = {
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.TASK,
        payload: {
          title: 'Test Task',
          description: 'Test description',
        },
        metadata: {
          priority: Priority.MEDIUM,
        },
      };

      const response = await engine.commit({
        nodes: [nodeData],
        edges: [],
        message: 'Test commit',
      });

      expect(response.success).toBe(true);
      expect(response.nodeIds).toHaveLength(1);
      expect(response.edgeIds).toHaveLength(0);
      expect(response.commitId).toBe(response.nodeIds[0]);

      const savedNode = await engine.getNode(response.nodeIds[0]);
      expect(savedNode).toBeTruthy();
      expectNodeToMatch(savedNode!, {
        nodeType: nodeData.nodeType,
        author: nodeData.author,
        payload: nodeData.payload,
        metadata: nodeData.metadata,
      });
    });

    it('should commit multiple nodes successfully', async () => {
      const nodeData1 = {
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: 'Task 1' },
        metadata: {},
      };

      const nodeData2 = {
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.FEATURE,
        payload: { title: 'Feature 1' },
        metadata: {},
      };

      const response = await engine.commit({
        nodes: [nodeData1, nodeData2],
        edges: [],
        message: 'Multi-node commit',
      });

      expect(response.success).toBe(true);
      expect(response.nodeIds).toHaveLength(2);

      const node1 = await engine.getNode(response.nodeIds[0]);
      const node2 = await engine.getNode(response.nodeIds[1]);

      expect(node1?.payload.title).toBe('Task 1');
      expect(node2?.payload.title).toBe('Feature 1');
    });

    it('should handle parent IDs correctly', async () => {
      const mainBranch = await context.storage.getBranch('main');
      const parentId = mainBranch!.headNodeId;

      const nodeData = {
        author: Author.HUMAN,
        parentIds: [parentId],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: 'Child Task' },
        metadata: {},
      };

      const response = await engine.commit({
        nodes: [nodeData],
        edges: [],
        message: 'Child commit',
      });

      const savedNode = await engine.getNode(response.nodeIds[0]);
      expect(savedNode?.parentIds).toContain(parentId);
    });

    it('should auto-assign parent ID when none provided', async () => {
      const mainBranch = await context.storage.getBranch('main');
      const originalHeadId = mainBranch!.headNodeId;

      const nodeData = {
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: 'Auto Parent Task' },
        metadata: {},
      };

      const response = await engine.commit({
        nodes: [nodeData],
        edges: [],
        message: 'Auto parent commit',
      });

      const savedNode = await engine.getNode(response.nodeIds[0]);
      expect(savedNode?.parentIds).toContain(originalHeadId);
    });

    it('should emit commit event', async () => {
      const nodeData = {
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: 'Event Test Task' },
        metadata: {},
      };

      const eventPromise = assertEventEmitted(engine, 'commit');

      await engine.commit({
        nodes: [nodeData],
        edges: [],
        message: 'Event test commit',
      });

      const eventData = await eventPromise;
      expect(eventData.success).toBe(true);
      expect(eventData.nodeIds).toHaveLength(1);
    });
  });

  describe('Edge Operations', () => {
    it('should commit edges successfully', async () => {
      // First create two nodes
      const response1 = await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.TASK,
          payload: { title: 'Source Task' },
          metadata: {},
        }],
        edges: [],
        message: 'Source commit',
      });

      const response2 = await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.TASK,
          payload: { title: 'Target Task' },
          metadata: {},
        }],
        edges: [],
        message: 'Target commit',
      });

      // Now create edge between them
      const edgeData = {
        sourceNodeId: response1.nodeIds[0],
        targetNodeId: response2.nodeIds[0],
        edgeType: DevelopmentEdgeType.REQUIRES,
        metadata: { strength: 'strong' },
      };

      const edgeResponse = await engine.commit({
        nodes: [],
        edges: [edgeData],
        message: 'Edge commit',
      });

      expect(edgeResponse.success).toBe(true);
      expect(edgeResponse.edgeIds).toHaveLength(1);

      const savedEdge = await context.storage.getEdge(edgeResponse.edgeIds[0]);
      expect(savedEdge).toBeTruthy();
      expect(savedEdge?.sourceNodeId).toBe(response1.nodeIds[0]);
      expect(savedEdge?.targetNodeId).toBe(response2.nodeIds[0]);
      expect(savedEdge?.edgeType).toBe(DevelopmentEdgeType.REQUIRES);
    });

    it('should get incoming edges correctly', async () => {
      const task = await createSampleTask(context);

      const testNode = {
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.TEST,
        payload: { title: 'Test for task' },
        metadata: {},
      };

      const response = await engine.commit({
        nodes: [testNode],
        edges: [],
        message: 'Create test node',
      });

      const edgeResponse = await engine.commit({
        nodes: [],
        edges: [{
          sourceNodeId: response.nodeIds[0],
          targetNodeId: task.nodeId,
          edgeType: DevelopmentEdgeType.TESTS,
        }],
        message: 'Add test edge',
      });

      const incomingEdges = await engine.getEdgesByTarget(task.nodeId);
      expect(incomingEdges).toHaveLength(1);
      expect(incomingEdges[0].edgeType).toBe(DevelopmentEdgeType.TESTS);
    });
  });

  describe('Branch Operations', () => {
    it('should create new branch successfully', async () => {
      const response = await engine.branch({
        name: 'feature-branch',
        description: 'Feature development branch',
      });

      expect(response.success).toBe(true);
      expect(response.branch.name).toBe('feature-branch');
      expect(response.branch.description).toBe('Feature development branch');

      const savedBranch = await context.storage.getBranch('feature-branch');
      expect(savedBranch).toBeTruthy();
      expect(savedBranch?.name).toBe('feature-branch');
    });

    it('should create branch from specific node', async () => {
      const task = await createSampleTask(context);

      const response = await engine.branch({
        name: 'task-branch',
        fromNodeId: task.nodeId,
        description: 'Branch from task',
      });

      expect(response.success).toBe(true);
      expect(response.branch.headNodeId).toBe(task.nodeId);
    });

    it('should checkout branch successfully', async () => {
      await engine.branch({
        name: 'test-branch',
        description: 'Test checkout',
      });

      await engine.checkout('test-branch');
      expect(engine.getCurrentBranch()).toBe('test-branch');
    });

    it('should emit branch events', async () => {
      const createEventPromise = assertEventEmitted(engine, 'branch:created');
      const switchEventPromise = assertEventEmitted(engine, 'branch:switched');

      await engine.branch({
        name: 'event-branch',
        description: 'Event test branch',
      });

      await engine.checkout('event-branch');

      const createEvent = await createEventPromise;
      const switchEvent = await switchEventPromise;

      expect(createEvent.name).toBe('event-branch');
      expect(switchEvent.name).toBe('event-branch');
    });

    it('should throw error when checking out non-existent branch', async () => {
      await expect(engine.checkout('non-existent')).rejects.toThrow();
    });
  });

  describe('Merge Operations', () => {
    it('should perform fast-forward merge', async () => {
      // Create feature branch
      await engine.branch({
        name: 'feature',
        description: 'Feature branch',
      });

      await engine.checkout('feature');

      // Add commit to feature branch
      await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { title: 'Feature work' },
          metadata: {},
        }],
        edges: [],
        message: 'Feature commit',
      });

      // Merge back to main
      const response = await engine.merge({
        fromBranch: 'feature',
        intoBranch: 'main',
        strategy: MergeStrategy.FAST_FORWARD,
      });

      expect(response.success).toBe(true);

      const mainBranch = await context.storage.getBranch('main');
      const featureBranch = await context.storage.getBranch('feature');

      expect(mainBranch?.headNodeId).toBe(featureBranch?.headNodeId);
    });

    it('should perform recursive merge', async () => {
      // Create and switch to feature branch
      await engine.branch({ name: 'feature', description: 'Feature branch' });
      await engine.checkout('feature');

      // Add commit to feature
      const featureResponse = await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { title: 'Feature work' },
          metadata: {},
        }],
        edges: [],
        message: 'Feature commit',
      });

      // Switch back to main and add commit
      await engine.checkout('main');
      const mainResponse = await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { title: 'Main work' },
          metadata: {},
        }],
        edges: [],
        message: 'Main commit',
      });

      // Perform recursive merge
      const mergeResponse = await engine.merge({
        fromBranch: 'feature',
        intoBranch: 'main',
        strategy: MergeStrategy.RECURSIVE,
        message: 'Merge feature into main',
      });

      expect(mergeResponse.success).toBe(true);
      expect(mergeResponse.mergeNodeId).toBeTruthy();

      // Check merge node has both parents
      const mergeNode = await engine.getNode(mergeResponse.mergeNodeId!);
      expect(mergeNode?.parentIds).toHaveLength(2);
      expect(mergeNode?.parentIds).toContain(featureResponse.nodeIds[0]);
      expect(mergeNode?.parentIds).toContain(mainResponse.nodeIds[0]);
    });

    it('should perform squash merge', async () => {
      // Create feature branch with multiple commits
      await engine.branch({ name: 'feature', description: 'Feature branch' });
      await engine.checkout('feature');

      await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { title: 'Feature commit 1' },
          metadata: {},
        }],
        edges: [],
        message: 'Feature commit 1',
      });

      await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.FEATURE,
          payload: { title: 'Feature commit 2' },
          metadata: {},
        }],
        edges: [],
        message: 'Feature commit 2',
      });

      // Squash merge to main
      const mergeResponse = await engine.merge({
        fromBranch: 'feature',
        intoBranch: 'main',
        strategy: MergeStrategy.SQUASH,
        message: 'Squash merge feature',
      });

      expect(mergeResponse.success).toBe(true);

      const squashNode = await engine.getNode(mergeResponse.mergeNodeId!);
      expect(squashNode?.nodeType).toBe(DevelopmentNodeType.INTEGRATION);
      expect(squashNode?.payload.squashedNodes).toBeTruthy();
    });

    it('should emit merge event', async () => {
      await engine.branch({ name: 'test-merge', description: 'Test merge' });

      const eventPromise = assertEventEmitted(engine, 'merge:completed');

      await engine.merge({
        fromBranch: 'test-merge',
        intoBranch: 'main',
        strategy: MergeStrategy.FAST_FORWARD,
      });

      const eventData = await eventPromise;
      expect(eventData.success).toBe(true);
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Create test data
      await engine.commit({
        nodes: [
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.TASK,
            payload: { title: 'Task 1' },
            metadata: { priority: Priority.HIGH },
          },
          {
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.FEATURE,
            payload: { title: 'Feature 1' },
            metadata: { complexity: 5 },
          },
          {
            author: Author.SYSTEM,
            parentIds: [],
            nodeType: DevelopmentNodeType.ERROR,
            payload: { message: 'Error occurred' },
            metadata: { severity: 'HIGH' },
          },
        ],
        edges: [],
        message: 'Test data setup',
      });
    });

    it('should get all nodes', async () => {
      const nodes = await engine.getAllNodes();
      expect(nodes.length).toBeGreaterThanOrEqual(4); // 1 root + 3 test nodes
    });

    it('should get all edges', async () => {
      const edges = await engine.getAllEdges();
      expect(Array.isArray(edges)).toBe(true);
    });

    it('should query by node type', async () => {
      const tasks = await engine.queryByType(DevelopmentNodeType.TASK);
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.every(n => n.nodeType === DevelopmentNodeType.TASK)).toBe(true);
    });

    it('should query by metadata', async () => {
      const highPriorityNodes = await engine.queryByMetadata({ priority: Priority.HIGH });
      expect(highPriorityNodes.length).toBeGreaterThanOrEqual(1);
      expect(highPriorityNodes.every(n => n.metadata.priority === Priority.HIGH)).toBe(true);
    });

    it('should search nodes', async () => {
      const results = await engine.search('Task 1');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some(n => n.payload.title?.includes('Task 1'))).toBe(true);
    });

    it('should get recent nodes', async () => {
      const recent = await engine.getRecentNodes(2);
      expect(recent).toHaveLength(2);

      // Should be sorted by timestamp descending
      if (recent.length > 1) {
        expect(recent[0].timestamp.getTime()).toBeGreaterThanOrEqual(
          recent[1].timestamp.getTime()
        );
      }
    });
  });

  describe('Diff and Blame Operations', () => {
    it('should perform diff between nodes', async () => {
      const response1 = await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.TASK,
          payload: { title: 'Original Task' },
          metadata: {},
        }],
        edges: [],
        message: 'Original commit',
      });

      const response2 = await engine.commit({
        nodes: [{
          author: Author.HUMAN,
          parentIds: [],
          nodeType: DevelopmentNodeType.TASK,
          payload: { title: 'Modified Task' },
          metadata: {},
        }],
        edges: [],
        message: 'Modified commit',
      });

      const diff = await engine.diff(response1.nodeIds[0], response2.nodeIds[0]);

      expect(diff.addedNodes).toHaveLength(1);
      expect(diff.addedNodes[0].payload.title).toBe('Modified Task');
    });

    it('should perform blame operation', async () => {
      // Create a chain of related nodes for blame tracing
      const parentTask = await createSampleTask(context, { title: 'Parent Task' });
      const childTask = await createSampleTask(context, { title: 'Child Task' });

      // Create a dependency relationship
      await engine.commit({
        nodes: [],
        edges: [{
          sourceNodeId: parentTask.nodeId,
          targetNodeId: childTask.nodeId,
          edgeType: DevelopmentEdgeType.PARENT_OF,
        }],
        message: 'Add dependency relationship',
      });

      const blame = await engine.blame(childTask.nodeId);

      // Basic structure tests - blame should return valid structure
      expect(blame).toBeTruthy();
      expect(blame.path).toBeInstanceOf(Array);
      expect(blame.edges).toBeInstanceOf(Array);
      expect(typeof blame.depth).toBe('number');

      // For now, just ensure the operation doesn't crash
      expect(blame.depth).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Code Commit Operations', () => {
    it('should commit code changes', async () => {
      const response = await engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          {
            path: 'src/test.ts',
            action: 'modify',
            diff: '+console.log("test");\n-console.log("old");',
          },
        ],
        message: 'Add logging',
        metrics: {
          linesAdded: 1,
          linesRemoved: 1,
          testCoverage: 0.85,
        },
      });

      expect(response.success).toBe(true);

      const node = await engine.getNode(response.nodeIds[0]);
      expect(node?.payload.files).toHaveLength(1);
      expect(node?.metadata.filesModified).toContain('src/test.ts');
      expect(node?.metadata.linesAdded).toBe(1);
      expect(node?.metadata.linesRemoved).toBe(1);
    });
  });

  describe('Experiment Operations', () => {
    it('should create experiment branch', async () => {
      const response = await engine.experiment(
        'performance-test',
        'Test if new algorithm improves performance'
      );

      expect(response.success).toBe(true);
      expect(response.branch.name).toBe('experiment/performance-test');

      const branch = await context.storage.getBranch('experiment/performance-test');
      expect(branch).toBeTruthy();
    });
  });

  describe('Component Query Operations', () => {
    it('should query by component path', async () => {
      await engine.commitCode({
        type: DevelopmentNodeType.FEATURE,
        files: [
          {
            path: 'src/components/Button.tsx',
            action: 'create',
          },
        ],
        message: 'Create Button component',
      });

      const nodes = await engine.queryComponent('components/Button');
      expect(nodes.length).toBeGreaterThan(0);
      expect(nodes.some(n =>
        n.metadata.filesModified?.some(f => f.includes('Button'))
      )).toBe(true);
    });
  });

  describe('Metrics and Analytics', () => {
    beforeEach(async () => {
      // Create sample data for metrics
      const fixedDate = new Date('2024-01-15T10:00:00Z');
      const restoreDate = mockDate(fixedDate);

      try {
        await engine.commit({
          nodes: [
            {
              author: Author.HUMAN,
              parentIds: [],
              nodeType: DevelopmentNodeType.TASK,
              payload: { title: 'Completed Task' },
              metadata: {
                status: TaskStatus.DONE,
                timeSpent: 8,
                testCoverage: 0.9,
              },
            },
            {
              author: Author.SYSTEM,
              parentIds: [],
              nodeType: DevelopmentNodeType.ERROR,
              payload: { message: 'Test error' },
              metadata: { errorCount: 1 },
            },
            {
              author: Author.HUMAN,
              parentIds: [],
              nodeType: DevelopmentNodeType.BENCHMARK,
              payload: {
                operation: 'search',
                throughput: 1000,
              },
              metadata: { throughput: 1000 },
            },
          ],
          edges: [],
          message: 'Metrics test data',
        });
      } finally {
        restoreDate();
      }
    });

    it('should get development metrics', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');

      const metrics = await engine.getMetrics(from, to);

      expect(metrics.totalNodes).toBeGreaterThan(0);
      expect(metrics.nodesByType).toBeTruthy();
      expect(metrics.totalEdges).toBeGreaterThanOrEqual(0);
      expect(metrics.testCoverage).toBeGreaterThanOrEqual(0);
      expect(metrics.averageCycleTime).toBeGreaterThanOrEqual(0);
    });

    it('should analyze error patterns', async () => {
      // Add more errors for pattern analysis
      await engine.commit({
        nodes: [
          {
            author: Author.SYSTEM,
            parentIds: [],
            nodeType: DevelopmentNodeType.ERROR,
            payload: { message: 'Null pointer exception in user service' },
            metadata: {},
          },
          {
            author: Author.SYSTEM,
            parentIds: [],
            nodeType: DevelopmentNodeType.ERROR,
            payload: { message: 'Null pointer exception in order service' },
            metadata: {},
          },
          {
            author: Author.SYSTEM,
            parentIds: [],
            nodeType: DevelopmentNodeType.ERROR,
            payload: { message: 'Database connection timeout' },
            metadata: {},
          },
        ],
        edges: [],
        message: 'Error pattern test',
      });

      const patterns = await engine.analyzeErrors(1);
      expect(patterns.length).toBeGreaterThanOrEqual(1);

      const nullPointerPattern = patterns.find(p =>
        p.pattern.includes('null pointer')
      );
      expect(nullPointerPattern).toBeTruthy();
      expect(nullPointerPattern?.frequency).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Report Generation', () => {
    it('should generate JSON report', async () => {
      const report = await engine.generateReport('json');

      const parsed = JSON.parse(report);
      expect(parsed.timestamp).toBeTruthy();
      expect(parsed.metrics).toBeTruthy();
      expect(parsed.errors).toBeTruthy();
      expect(parsed.branches).toBeTruthy();
    });

    it('should generate markdown report', async () => {
      const report = await engine.generateReport('markdown');

      expect(report).toContain('# Development Report');
      expect(report).toContain('## Metrics');
      expect(report).toContain('## Node Distribution');
      expect(report).toContain('## Active Branches');
    });
  });

  describe('Error Handling', () => {
    it('should emit error event on commit failure', async () => {
      const eventPromise = assertEventEmitted(engine, 'error');

      try {
        // This should fail due to invalid node structure
        await engine.commit({
          nodes: [null as any],
          edges: [],
          message: 'Invalid commit',
        });
      } catch (error) {
        // Expected to throw
      }

      const errorEvent = await eventPromise;
      expect(errorEvent).toBeTruthy();
    });

    it('should handle non-existent node queries gracefully', async () => {
      const node = await engine.getNode('non-existent-id');
      expect(node).toBeNull();
    });

    it('should handle invalid branch operations', async () => {
      await expect(engine.merge({
        fromBranch: 'non-existent',
        intoBranch: 'main',
        strategy: MergeStrategy.FAST_FORWARD,
      })).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle multiple commits efficiently', async () => {
      const start = performance.now();

      const promises = Array.from({ length: 10 }, (_, i) =>
        engine.commit({
          nodes: [{
            author: Author.HUMAN,
            parentIds: [],
            nodeType: DevelopmentNodeType.TASK,
            payload: { title: `Batch Task ${i}` },
            metadata: {},
          }],
          edges: [],
          message: `Batch commit ${i}`,
        })
      );

      await Promise.all(promises);

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should handle large node queries efficiently', async () => {
      // Create many nodes
      const nodes = Array.from({ length: 50 }, (_, i) => ({
        author: Author.HUMAN,
        parentIds: [],
        nodeType: DevelopmentNodeType.TASK,
        payload: { title: `Large Query Task ${i}` },
        metadata: { index: i },
      }));

      await engine.commit({
        nodes,
        edges: [],
        message: 'Large batch commit',
      });

      const start = performance.now();
      const allNodes = await engine.getAllNodes();
      const elapsed = performance.now() - start;

      expect(allNodes.length).toBeGreaterThanOrEqual(50);
      expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});