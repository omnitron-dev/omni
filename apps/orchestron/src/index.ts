export * from './core/types.js';
export * from './core/engine.js';
export * from './storage/interface.js';
export * from './storage/sqlite.js';
export * from './core/ml-predictor.js';
export * from './core/workflow-engine.js';
export * from './core/feedback-collector.js';
export * from './core/learning-pipeline.js';

import { OrchestronEngine } from './core/engine.js';
import { SQLiteStorage } from './storage/sqlite.js';
import {
  Author,
  DevelopmentNodeType,
  DevelopmentEdgeType,
  MergeStrategy,
  Priority,
  TaskStatus,
} from './core/types.js';

export interface OrchestronConfig {
  storagePath?: string;
  autoTrack?: boolean;
}

export async function initializeOrchestron(config: OrchestronConfig = {}): Promise<OrchestronEngine> {
  const storage = new SQLiteStorage(config.storagePath || '.orchestron.db');
  const engine = new OrchestronEngine(storage);

  if (config.autoTrack) {
    console.log('Auto-tracking enabled for development');
  }

  return engine;
}

export async function trackDevelopmentDecision(
  engine: OrchestronEngine,
  decision: {
    type: DevelopmentNodeType;
    title: string;
    rationale: string;
    alternatives?: string[];
    tradeoffs?: { pros: string[]; cons: string[] };
  }
): Promise<void> {
  await engine.commit({
    nodes: [{
      author: Author.HUMAN,
      parentIds: [],
      nodeType: decision.type,
      payload: {
        title: decision.title,
        rationale: decision.rationale,
        alternatives: decision.alternatives,
        tradeoffs: decision.tradeoffs,
        timestamp: new Date(),
      },
      metadata: {
        priority: Priority.HIGH,
        status: TaskStatus.DONE,
      },
    }] as any,
    edges: [],
    message: `Decision: ${decision.title}`,
  });
}

export async function trackError(
  engine: OrchestronEngine,
  error: {
    message: string;
    stack?: string;
    component: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }
): Promise<void> {
  await engine.commit({
    nodes: [{
      author: Author.SYSTEM,
      parentIds: [],
      nodeType: DevelopmentNodeType.ERROR,
      payload: {
        message: error.message,
        stack: error.stack,
        component: error.component,
        timestamp: new Date(),
      },
      metadata: {
        priority: error.severity === 'CRITICAL' ? Priority.CRITICAL :
                 error.severity === 'HIGH' ? Priority.HIGH :
                 error.severity === 'MEDIUM' ? Priority.MEDIUM :
                 Priority.LOW,
        status: TaskStatus.TODO,
      },
    }] as any,
    edges: [],
    message: `Error: ${error.message}`,
  });
}

export async function trackPerformance(
  engine: OrchestronEngine,
  benchmark: {
    operation: string;
    before: { throughput: number; latency?: number };
    after: { throughput: number; latency?: number };
    improvement: string;
  }
): Promise<void> {
  await engine.commit({
    nodes: [{
      author: Author.SYSTEM,
      parentIds: [],
      nodeType: DevelopmentNodeType.BENCHMARK,
      payload: {
        operation: benchmark.operation,
        before: benchmark.before,
        after: benchmark.after,
        improvement: benchmark.improvement,
        timestamp: new Date(),
      },
      metadata: {
        throughput: benchmark.after.throughput,
        executionTime: benchmark.after.latency,
      },
    }] as any,
    edges: [],
    message: `Benchmark: ${benchmark.operation} - ${benchmark.improvement}`,
  });
}

export const OrchestronTools = {
  initializeOrchestron,
  trackDevelopmentDecision,
  trackError,
  trackPerformance,
  Author,
  DevelopmentNodeType,
  DevelopmentEdgeType,
  MergeStrategy,
};