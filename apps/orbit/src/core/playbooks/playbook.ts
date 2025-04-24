import { Task } from '../tasks/task';

export interface PlaybookOptions {
  name?: string;
  description?: string;
}

export class Playbook {
  public readonly name: string;
  public readonly description?: string;
  private tasks: Task[];

  constructor(tasks: Task[], options?: PlaybookOptions) {
    this.tasks = tasks;
    this.name = options?.name || 'Unnamed Playbook';
    this.description = options?.description;
  }

  getTasks(): Task[] {
    return this.tasks;
  }
}