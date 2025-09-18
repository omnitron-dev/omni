/**
 * Global type definitions for titan
 */

import type { IShutdownTask } from './modules/process-lifecycle/types';

declare global {
  var __titanShutdownTasks: IShutdownTask[] | undefined;
}