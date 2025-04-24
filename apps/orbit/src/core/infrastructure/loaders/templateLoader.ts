import fs from 'fs';
import path from 'path';

import { TemplateEngine } from '../../templating/templateEngine';

export interface Template {
  name: string;
  content: string;
}

export class TemplateLoader {
  private templates: Map<string, Template> = new Map();

  constructor(private templatesDir: string, private engine: TemplateEngine) { }

  loadAll(): void {
    if (!fs.existsSync(this.templatesDir)) {
      throw new Error(`Templates directory does not exist: ${this.templatesDir}`);
    }

    const templateFiles = fs.readdirSync(this.templatesDir).filter((file) => file.endsWith('.mustache'));

    templateFiles.forEach((file) => {
      const fullPath = path.join(this.templatesDir, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const templateName = path.basename(file, '.mustache');

      this.templates.set(templateName, {
        name: templateName,
        content,
      });
    });
  }

  render(templateName: string, vars: Record<string, any>): string {
    const template = this.templates.get(templateName);

    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }

    return this.engine.render(template.content, vars);
  }

  getTemplateNames(): string[] {
    return Array.from(this.templates.keys());
  }
}
