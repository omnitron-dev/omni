import { Logger, AlertDetails, AlertingService } from '../../types/common';

export class DefaultAlertingService implements AlertingService {
  constructor(private logger: Logger) { }

  async sendAlert(details: AlertDetails): Promise<void> {
    this.logger.warn('Alert triggered', details);
  }
}