export * from './core/types';
export * from './core/engine';
export * from './storage/interface';
export * from './storage/sqlite';
export * from './core/ml-predictor';

import { OrchestronEngine } from './core/engine';
import { SQLiteStorage } from './storage/sqlite';
import {
  Author,
  DevelopmentNodeType,
  DevelopmentEdgeType,
  MergeStrategy,
  Priority,
  TaskStatus,
} from './core/types';

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