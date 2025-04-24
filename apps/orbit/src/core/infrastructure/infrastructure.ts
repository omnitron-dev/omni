import { Task } from '../tasks/task';
import { Playbook } from '../playbooks/playbook';
import { Inventory } from '../inventory/inventory';
import { Variables } from '../templating/variables';
import { OrbitConfig } from '../config/orbitConfig';
import { TemplateLoader } from './loaders/templateLoader';

export interface InfrastructureOptions {
  inventory: Inventory;
  playbooks: Record<string, Playbook>;
  tasks: Record<string, Task>;
  templates?: TemplateLoader;
  variables: Variables;
  settings: OrbitConfig;
}

export class Infrastructure {
  public readonly inventory: Inventory;
  public readonly playbooks: Record<string, Playbook>;
  public readonly tasks: Record<string, Task>;
  public readonly templates?: TemplateLoader;
  public readonly variables: Variables;
  public readonly settings: OrbitConfig;

  constructor(options: InfrastructureOptions) {
    this.inventory = options.inventory;
    this.playbooks = options.playbooks;
    this.tasks = options.tasks;
    this.templates = options.templates;
    this.variables = options.variables;
    this.settings = options.settings;
  }
}
