import { Command } from 'commander';

import { Orbit } from '../index';
import { Logger, LoggerLevel } from '../types/common';
import { deployCommand } from './commands/deployCommand';
import { StructuredLogger } from '../core/logging/logger';
import { ConfigLoader } from '../core/config/configLoader';
import { metricsCommand } from './commands/metricsCommand';
import { playbookCommand } from './commands/playbookCommand';
import { inventoryCommand } from './commands/inventoryCommand';
import { LogFormat, OrbitConfig } from '../core/config/orbitConfig';
import { JsonLogFormatter, SimpleLogFormatter } from '../core/logging/logFormatter';

const program = new Command();

program
  .name('orbit')
  .description('Orbit CLI for infrastructure management and automation')
  .version('1.0.0')
  .option('-c, --config <path>', 'Specify path to configuration file')
  .option('-l, --log-level <level>', 'Specify log level (trace, debug, info, warn, error)')
  .option('-f, --log-format <format>', 'Log format (json, simple)', 'simple')
  .option('-d, --dry-run', 'Execute playbooks in dry-run mode');

program.parse(process.argv);
const options = program.opts();

const config: OrbitConfig = options["config"]
  ? ConfigLoader.loadFromFile(options["config"])
  : ConfigLoader.loadFromEnv();

if (options["logLevel"]) {
  config.logLevel = options["logLevel"] as LoggerLevel;
}

if (options["dryRun"] !== undefined) {
  config.dryRun = options["dryRun"];
}

if (options["logFormat"]) {
  config.logFormat = options["logFormat"] as LogFormat;
}

// Динамическое определение формата логирования
const logFormatter = config.logFormat === 'json'
  ? new JsonLogFormatter()
  : new SimpleLogFormatter();

const logger: Logger = new StructuredLogger(logFormatter, config.logLevel);

logger.info('Orbit CLI initialized', { config });

const orbit = new Orbit(config);
const inventory = orbit.inventory;
const context = orbit.context;

deployCommand(program, context, inventory);
inventoryCommand(program, inventory);
playbookCommand(program, context);
metricsCommand(program);
