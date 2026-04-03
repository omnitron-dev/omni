/**
 * Invalid workflow without @Workflow decorator - for error testing
 */

export class InvalidWorkflow {
  async step1(): Promise<void> {
    // This class is missing the @Workflow() decorator
  }
}

export default InvalidWorkflow;
