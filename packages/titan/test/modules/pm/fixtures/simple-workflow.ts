/**
 * Simple workflow fixture for file-based loading tests
 */
import { Workflow, Stage } from '../../../../src/modules/pm/decorators.js';

@Workflow()
export class SimpleWorkflow {
  public executionLog: string[] = [];

  @Stage({ name: 'step1' })
  async step1(input: string): Promise<{ data: string }> {
    this.executionLog.push('step1');
    return { data: `${input}-processed` };
  }

  @Stage({ name: 'step2', dependsOn: 'step1' })
  async step2(input: any): Promise<{ result: string }> {
    this.executionLog.push('step2');
    const prevData = input.data || input;
    return { result: `${prevData}-complete` };
  }
}

// Default export for testing default export pattern
export default SimpleWorkflow;
