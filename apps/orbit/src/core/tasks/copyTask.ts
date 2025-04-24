import { Host } from '../inventory/host';
import { Task, TaskOptions } from './task';
import { SSHTaskExecutor } from './sshTaskExecutor';
import { OrbitResult, OrbitContext } from '../../types/common';

export interface CopyTaskOptions extends TaskOptions {
  localPath: string;
  remotePath: string;
  rollbackRemotePath?: string;
}

export class CopyTask extends Task {
  constructor(private options: CopyTaskOptions) {
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

    try {
      await executor.uploadFile(this.options.localPath, this.options.remotePath);
      context.logger.info(`File "${this.options.localPath}" copied to "${host.hostname}:${this.options.remotePath}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error };
    }
  }

  override async rollback(host: Host, context: OrbitContext): Promise<OrbitResult> {
    const executor = new SSHTaskExecutor({
      host: host.ip,
      username: host.username,
      port: host.port,
      privateKeyPath: host.privateKeyPath,
      timeout: this.timeout,
    });

    const targetPath = this.options.rollbackRemotePath || this.options.remotePath;
    const rollbackCommand = `rm -f ${targetPath}`;

    try {
      const result = await executor.executeCommand(rollbackCommand);
      context.logger.info(`Rollback succeeded: file "${targetPath}" removed from "${host.hostname}"`);
      return { success: true, data: result };
    } catch (error: any) {
      context.logger.error(`Rollback failed on "${host.hostname}": ${error.message}`);
      return { success: false, error };
    }
  }
}
