import { ISSHClient, SSHCommandResult, SSHCommandOptions } from '../../types/ssh';

type CommandMockResult = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export class MockSSHClient implements ISSHClient {
  private commandMocks: Record<string, CommandMockResult>;
  public executedCommands: string[] = [];

  constructor(commandMocks?: Record<string, CommandMockResult>) {
    this.commandMocks = commandMocks || {};
  }

  async connect(): Promise<void> {
    // Мок подключения всегда успешен
    return;
  }

  async executeCommand(command: string, options?: SSHCommandOptions): Promise<SSHCommandResult> {
    this.executedCommands.push(command);

    // Возвращаем заранее заданный результат, либо успешный по умолчанию
    const mock = this.commandMocks[command] || {
      stdout: 'Mocked command output',
      stderr: '',
      exitCode: 0,
    };

    return {
      stdout: mock.stdout || '',
      stderr: mock.stderr || '',
      exitCode: mock.exitCode ?? 0,
    };
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    // Просто эмулируем успех загрузки файла
    return;
  }

  async close(): Promise<void> {
    return;
  }
}
