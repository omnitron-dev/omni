
import * as Mustache from 'mustache';

import { Variables } from './variables';

export class TemplateEngine {
  private variables: Variables;

  constructor(variables?: Variables) {
    this.variables = variables || new Variables();
  }

  render(template: string, additionalVars?: Record<string, any>): string {
    const vars = this.variables.getAll();
    if (additionalVars) {
      Object.assign(vars, additionalVars);
    }
    return Mustache.render(template, vars);
  }
}