import { Host } from '../inventory/host';
import { Task, TaskOptions } from './task';
import { SSHTaskExecutor } from './sshTaskExecutor';
import { OrbitResult, OrbitContext } from '../../types/common';


export interface ShellTaskOptions extends TaskOptions {
  command: string;
  args?: string[];
  rollbackCommand?: string;
}

export class ShellTask extends Task {
  constructor(private options: ShellTaskOptions) {
    super(options);
  }

  protected async execute(host: Host, context: OrbitContext): Promise<OrbitResult> {
    const executor = new SSHTaskExecutor({
      host: host.ip,
      username: host.username,
      port: host.port,
      privateKeyPath: host.privateKeyPath,
      timeout: this.timeout,
    });

    const fullCommand = this.options.args
      ? `${this.options.command} ${this.options.args.join(' ')}`
      : this.options.command;

    try {
      const result = await executor.executeCommand(fullCommand);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error };
    }
  }

  override async rollback(host: Host, context: OrbitContext): Promise<OrbitResult> {
    if (!this.options.rollbackCommand) {
      context.logger.warn(`No rollback command provided for task "${this.name}"`);
      return { success: true };
    }

    const executor = new SSHTaskExecutor({
      host: host.ip,
      username: host.username,
      port: host.port,
      privateKeyPath: host.privateKeyPath,
      timeout: this.timeout,
    });

    try {
      const result = await executor.executeCommand(this.options.rollbackCommand);
      return { success: true, data: result };
    } catch (error: any) {
      return { success: false, error };
    }
  }
}

