import { afterAll } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionService } from '../../src/execution/execution.service.js';

/** Real common executor with a fixture-owned lifecycle. Never addresses infrastructure. */
export const testExecution = new ExecutionService(createNullLogger());
afterAll(() => testExecution.dispose());
