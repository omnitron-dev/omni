import { join } from 'path';
import { existsSync } from 'fs';

import { Infrastructure } from './infrastructure';
import { TaskLoader } from './loaders/taskLoader';
import { Variables } from '../templating/variables';
import { PlaybookLoader } from './loaders/playbookLoader';
import { TemplateLoader } from './loaders/templateLoader';
import { InventoryLoader } from './loaders/inventoryLoader';
import { TemplateEngine } from '../templating/templateEngine';
import { InfrastructureConfigLoader } from './loaders/configLoader';

export class InfrastructureLoader {
  static load(infraDir: string): Infrastructure {
    if (!existsSync(infraDir)) {
      throw new Error(`Infrastructure directory "${infraDir}" not found`);
    }

    // Загрузка общей конфигурации и переменных
    const configDir = join(infraDir, 'configs');
    if (!existsSync(configDir)) {
      throw new Error(`Configs directory "${configDir}" not found`);
    }
    const configLoader = new InfrastructureConfigLoader(configDir);
    configLoader.load();

    const variables = new Variables(configLoader.getSettings().variables);
    const settings = configLoader.getSettings();

    // Загрузка инвентаря
    const inventoryPath = join(infraDir, 'inventory');
    if (!existsSync(inventoryPath)) {
      throw new Error(`Inventory directory "${inventoryPath}" not found`);
    }
    const inventory = InventoryLoader.load(inventoryPath);

    // Загрузка плейбуков
    const playbooksPath = join(infraDir, 'playbooks');
    if (!existsSync(playbooksPath)) {
      throw new Error(`Playbooks directory "${playbooksPath}" not found`);
    }
    const playbooks = PlaybookLoader.load(playbooksPath);

    // Загрузка задач
    const tasksPath = join(infraDir, 'tasks');
    if (!existsSync(tasksPath)) {
      throw new Error(`Tasks directory "${tasksPath}" not found`);
    }
    const tasks = TaskLoader.load(tasksPath);

    // Загрузка шаблонов
    const templatesDir = join(infraDir, 'templates');
    const templateEngine = new TemplateEngine(variables);
    const templateLoader = new TemplateLoader(templatesDir, templateEngine);
    templateLoader.loadAll();

    // Возвращаем полностью инициализированный экземпляр Infrastructure
    return new Infrastructure({
      inventory,
      playbooks,
      tasks,
      templates: templateLoader,
      variables,
      settings,
    });
  }
}
