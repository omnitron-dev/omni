import { SSHClient } from './sshClient';
import { Host } from '../inventory/host';
import { OrbitError } from '../errors/error';
import { Command, CommandResult } from './command';

export interface ExecutionOptions {
  parallel?: boolean;
  concurrencyLimit?: number;
  continueOnError?: boolean;
}

export class Executor {
  constructor(private options?: ExecutionOptions) { }

  async executeCommands(hosts: Host[], commands: Command[]): Promise<Record<string, CommandResult[]>> {
    const results: Record<string, CommandResult[]> = {};

    const executeOnHost = async (host: Host): Promise<void> => {
      const sshClient = new SSHClient({
        host: host.ip,
        port: host.port,
        username: host.username,
        privateKey: host.privateKeyPath,
        timeout: 20000,
      });

      await sshClient.connect();

      results[host.hostname] = [];

      for (const command of commands) {
        try {
          const fullCommand = command.args ? `${command.command} ${command.args.join(' ')}` : command.command;
          const result = await sshClient.executeCommand(fullCommand, command.options);
          results[host.hostname]?.push(result);

          if (result.exitCode !== 0 && !this.options?.continueOnError) {
            throw new OrbitError('COMMAND_EXECUTION_FAILED', `Command failed on ${host.hostname}: ${fullCommand}`, { stdout: result.stdout, stderr: result.stderr });

          }
        } catch (error) {
          if (!this.options?.continueOnError) {
            await sshClient.close();
            throw error;
          }
          results[host.hostname]?.push({ stdout: '', stderr: (error as Error).message, exitCode: -1 });
        }
      }

      await sshClient.close();
    };

    if (this.options?.parallel) {
      const concurrency = this.options.concurrencyLimit || 5;
      const executing: Promise<void>[] = [];

      for (const host of hosts) {
        const task = executeOnHost(host);
        executing.push(task);

        if (executing.length >= concurrency) {
          await Promise.race(executing).catch(() => { });
          executing.splice(0, executing.length - concurrency + 1);
        }
      }

      await Promise.all(executing);
    } else {
      for (const host of hosts) {
        await executeOnHost(host);
      }
    }

    return results;
  }
}
