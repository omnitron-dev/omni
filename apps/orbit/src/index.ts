import { Playbook } from './core/playbooks/playbook';
import { Inventory } from './core/inventory/inventory';
import { Variables } from './core/templating/variables';
import { LoggerFactory } from './core/logging/loggerFactory';
import { OrbitErrorHandler } from './core/errors/errorHandler';
import { Logger, OrbitContext, AlertingService } from './types/common';
import { OrbitConfig, defaultOrbitConfig } from './core/config/orbitConfig';
import { DefaultAlertingService } from './core/alerting/defaultAlertingService';

export class Orbit {
  public readonly inventory: Inventory;
  public readonly context: OrbitContext;
  private readonly logger: Logger;

  constructor(config?: OrbitConfig, alertingService?: AlertingService) {
    const mergedConfig = { ...defaultOrbitConfig, ...config };
    const variables = new Variables({ playbooks: {} });
    this.logger = LoggerFactory.createLogger({
      format: mergedConfig.logFormat,
      level: mergedConfig.logLevel,
    });

    this.inventory = new Inventory();
    this.context = {
      variables,
      config: mergedConfig,
      logger: this.logger,
      errorHandler: new OrbitErrorHandler(this.logger),
      alertingService: alertingService || new DefaultAlertingService(this.logger),
    };

    this.logger.info('Orbit initialized', { config: mergedConfig });
  }

  registerPlaybook(name: string, playbook: Playbook): void {
    const playbooks = this.context.variables.get('playbooks');
    this.context.variables.set('playbooks', {
      ...playbooks,
      [name]: playbook,
    });
  }

  getPlaybook(name: string): Playbook | undefined {
    const playbooks = this.context.variables.get('playbooks');
    return playbooks ? (playbooks[name] as Playbook) : undefined;
  }
}

export default Orbit;
