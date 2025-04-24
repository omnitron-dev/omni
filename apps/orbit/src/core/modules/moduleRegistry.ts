import { Module } from './module';

export class ModuleRegistry {
  private modules: Map<string, Module>;

  constructor() {
    this.modules = new Map();
  }

  register(module: Module): void {
    if (this.modules.has(module.name)) {
      throw new Error(`Module with name '${module.name}' already registered.`);
    }
    this.modules.set(module.name, module);
  }

  getModule(name: string): Module | undefined {
    return this.modules.get(name);
  }

  listModules(): Module[] {
    return Array.from(this.modules.values());
  }
}