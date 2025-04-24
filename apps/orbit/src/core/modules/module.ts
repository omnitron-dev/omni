import { Task } from '../tasks/task';

export interface ModuleOptions {
  name: string;
  description?: string;
}

export class Module {
  public readonly name: string;
  public readonly description?: string;
  private tasks: Task[];

  constructor(tasks: Task[], options: ModuleOptions) {
    this.tasks = tasks;
    this.name = options.name;
    this.description = options.description;
  }

  getTasks(): Task[] {
    return this.tasks;
  }
}