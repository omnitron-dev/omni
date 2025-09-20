/**
 * Global type definitions for titan
 */

import type { IShutdownTask } from './types';

declare global {
  var __titanShutdownTasks: IShutdownTask[] | undefined;
}