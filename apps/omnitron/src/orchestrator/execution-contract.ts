import type { IProcessInfo, IProcessMetrics, IWorkerHandle } from '@omnitron-dev/titan-pm';
import type { AppHandle } from './app-handle.js';
import type { OrchestratorService } from './orchestrator.service.js';
import type { ExposingSupervisor } from './call-exposed-service.js';
import type { IProcessEntry } from '../config/types.js';

type ExecutionTopology = Array<Pick<IProcessEntry, 'name' | 'instances' | 'transports'>> | null;

/** Controller-facing inventory. Native process and Worker handles stay with their owner. */
export interface AppExecutionView extends Pick<AppHandle,
  'entry' | 'name' | 'mode' | 'pid' | 'status' | 'startedAt' | 'restarts' | 'port' |
  'lastMetrics' | 'lastExit' | 'uptime' | 'instanceCount' | 'childMetrics'> {
  topologyProcesses: ExecutionTopology;
  supervisor: (ExposingSupervisor & {
    getChildProcessId(name: string): string | null | undefined;
    restartChild(name: string): Promise<void>;
  }) | null;
  topologyPools: Map<string, { getWorkerIds(): string[] }>;
}

type HandleMethods = 'startApp' | 'startKnownApp' | 'restartAfterChange' | 'restartApp' | 'reloadApp' | 'scaleApp';
type Methods = Omit<OrchestratorService, HandleMethods | 'getHandle' | 'getWorkerHandle' | 'getChildProcessInfo' | 'setConfig' | 'configureReadiness'>;

/** The backend has no direct access to ProcessManager, forks or threads. */
export interface OrchestratorControl extends Methods {
  startApp(...args: Parameters<OrchestratorService['startApp']>): Promise<AppExecutionView>;
  startKnownApp(name: string): Promise<AppExecutionView | undefined>;
  restartAfterChange(name: string): Promise<AppExecutionView | undefined>;
  restartApp(name: string): Promise<AppExecutionView>;
  reloadApp(name: string): Promise<AppExecutionView>;
  scaleApp(name: string, instances: number): Promise<AppExecutionView>;
  getHandle(name: string): AppExecutionView | undefined;
  getWorkerHandle(id: string): Pick<IWorkerHandle, 'pid' | 'serviceName' | 'serviceVersion'> | undefined;
  getChildProcessInfo(id: string): IProcessInfo | undefined;
  setConfig(...args: Parameters<OrchestratorService['setConfig']>): void | Promise<void>;
  configureReadiness(...args: Parameters<OrchestratorService['configureReadiness']>): void | Promise<void>;
}

export interface ExecutionAppSnapshot {
  info: ReturnType<OrchestratorService['list']>[number];
  entry: AppHandle['entry'];
  startedAt: number;
  instanceCount: number;
  lastMetrics: IProcessMetrics | null;
  lastExit: AppHandle['lastExit'];
  childMetrics: Array<[string, { cpu: number; memory: number }]>;
  topology: ExecutionTopology;
  children: Array<{ name: string; processId?: string }> | null;
  pools: Array<{ name: string; workerIds: string[] }>;
  logs: string[];
  declaredReadiness: boolean;
}
