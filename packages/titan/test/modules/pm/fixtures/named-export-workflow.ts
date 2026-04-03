/**
 * Named export workflow fixture for file-based loading tests
 */
import { Workflow, Stage } from '../../../../src/modules/pm/decorators.js';

@Workflow()
export class NamedExportWorkflow {
  public stageLog: string[] = [];

  @Stage({ name: 'initialize' })
  async initialize(data: any): Promise<{ initialized: boolean }> {
    this.stageLog.push('initialize');
    return { initialized: true };
  }

  @Stage({ name: 'process', dependsOn: 'initialize' })
  async process(data: any): Promise<{ processed: boolean }> {
    this.stageLog.push('process');
    return { processed: true };
  }

  @Stage({ name: 'finalize', dependsOn: 'process' })
  async finalize(data: any): Promise<{ complete: boolean }> {
    this.stageLog.push('finalize');
    return { complete: true };
  }
}
