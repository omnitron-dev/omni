import * as p from 'path';
import chalk from 'chalk';

import pathStructure from './paths';

export default {
  PREFIX_MSG: chalk.green('[OMNITRON] '),
  PREFIX_MSG_INFO: chalk.cyan('[OMNITRON][INFO] '),
  PREFIX_MSG_ERR: chalk.red('[OMNITRON][ERROR] '),
  PREFIX_MSG_MOD: chalk.bold.green('[OMNITRON][Module] '),
  PREFIX_MSG_MOD_ERR: chalk.red('[OMNITRON][Module][ERROR] '),
  PREFIX_MSG_WARNING: chalk.yellow('[OMNITRON][WARN] '),
  PREFIX_MSG_SUCCESS: chalk.cyan('[OMNITRON] '),

  OMNITRON_IO_MSG: chalk.cyan('[OMNITRON I/O]'),
  OMNITRON_IO_MSG_ERR: chalk.red('[OMNITRON I/O]'),

  TEMPLATE_FOLDER: p.join(__dirname, '../dist/templates'),

  APP_CONF_DEFAULT_FILE: 'ecosystem.config.js',
  APP_CONF_TPL: 'ecosystem.tpl',
  APP_CONF_TPL_SIMPLE: 'ecosystem-simple.tpl',
  SAMPLE_CONF_FILE: 'sample-conf.js',
  LOGROTATE_SCRIPT: 'logrotate.d/omnitron',

  DOCKERFILE_NODEJS: 'Dockerfiles/Dockerfile-nodejs.tpl',
  DOCKERFILE_JAVA: 'Dockerfiles/Dockerfile-java.tpl',
  DOCKERFILE_RUBY: 'Dockerfiles/Dockerfile-ruby.tpl',

  SUCCESS_EXIT: 0,
  ERROR_EXIT: 1,
  CODE_UNCAUGHTEXCEPTION: 1,

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  IS_BUN: typeof Bun !== 'undefined',
  IS_WINDOWS: process.platform === 'win32' || /^(msys|cygwin)$/.test(process.env['OSTYPE'] ?? ''),
  ONLINE_STATUS: 'online',
  STOPPED_STATUS: 'stopped',
  STOPPING_STATUS: 'stopping',
  WAITING_RESTART: 'waiting restart',
  LAUNCHING_STATUS: 'launching',
  ERRORED_STATUS: 'errored',
  ONE_LAUNCH_STATUS: 'one-launch-status',

  CLUSTER_MODE_ID: 'cluster_mode',
  FORK_MODE_ID: 'fork_mode',

  ENABLE_GIT_PARSING: false,
  LOW_MEMORY_ENVIRONMENT: process.env['OMNITRON_OPTIMIZE_MEMORY'] || false,

  SECRET_KEY: process.env['KEYMETRICS_SECRET'] || process.env['OMNITRON_SECRET_KEY'] || process.env['SECRET_KEY'],
  PUBLIC_KEY: process.env['KEYMETRICS_PUBLIC'] || process.env['OMNITRON_PUBLIC_KEY'] || process.env['PUBLIC_KEY'],
  KEYMETRICS_ROOT_URL:
    process.env['KEYMETRICS_NODE'] ||
    process.env['OMNITRON_APM_ADDRESS'] ||
    process.env['ROOT_URL'] ||
    process.env['INFO_NODE'] ||
    'root.keymetrics.io',

  DEFAULT_MODULE_JSON: 'package.json',

  MODULE_BASEFOLDER: 'module',
  MODULE_CONF_PREFIX: 'module-db-v2',
  MODULE_CONF_PREFIX_TAR: 'tar-modules',

  EXP_BACKOFF_RESET_TIMER: parseInt(process.env['EXP_BACKOFF_RESET_TIMER'] ?? '30000'),
  REMOTE_PORT_TCP: parseInt(process.env['KEYMETRICS_PUSH_PORT'] ?? '80'),
  REMOTE_PORT: 41624,
  REMOTE_HOST: 's1.keymetrics.io',
  SEND_INTERVAL: 1000,
  RELOAD_LOCK_TIMEOUT: parseInt(process.env['OMNITRON_RELOAD_LOCK_TIMEOUT'] ?? '30000'),
  GRACEFUL_TIMEOUT: parseInt(process.env['OMNITRON_GRACEFUL_TIMEOUT'] ?? '8000'),
  GRACEFUL_LISTEN_TIMEOUT: parseInt(process.env['OMNITRON_GRACEFUL_LISTEN_TIMEOUT'] ?? '3000'),
  LOGS_BUFFER_SIZE: 8,
  CONTEXT_ON_ERROR: 2,
  AGGREGATION_DURATION:
    process.env['OMNITRON_DEBUG'] || process.env['NODE_ENV'] === 'local_test' || process.env['NODE_ENV'] === 'development'
      ? 3000
      : 5 * 60000,
  TRACE_FLUSH_INTERVAL: process.env['OMNITRON_DEBUG'] || process.env['NODE_ENV'] === 'local_test' ? 1000 : 60000,

  // Concurrent actions when doing start/restart/reload
  CONCURRENT_ACTIONS: (() => {
    const concurrent_actions = parseInt(process.env['OMNITRON_CONCURRENT_ACTIONS'] ?? '2');
    return concurrent_actions;
  })(),

  DEBUG: process.env['OMNITRON_DEBUG'] || false,
  WEB_IPADDR: process.env['OMNITRON_API_IPADDR'] || '0.0.0.0',
  WEB_PORT: parseInt(process.env['OMNITRON_API_PORT'] ?? '9615'),
  WEB_STRIP_ENV_VARS: process.env['OMNITRON_WEB_STRIP_ENV_VARS'] || false,
  MODIFY_REQUIRE: process.env['OMNITRON_MODIFY_REQUIRE'] || false,

  WORKER_INTERVAL: process.env['OMNITRON_WORKER_INTERVAL'] || 30000,
  KILL_TIMEOUT: process.env['OMNITRON_KILL_TIMEOUT'] || 1600,
  KILL_SIGNAL: process.env['OMNITRON_KILL_SIGNAL'] || 'SIGINT',
  KILL_USE_MESSAGE: process.env['OMNITRON_KILL_USE_MESSAGE'] || false,

  OMNITRON_PROGRAMMATIC: typeof process.env['pm_id'] !== 'undefined' || process.env['OMNITRON_PROGRAMMATIC'],
  OMNITRON_LOG_DATE_FORMAT:
    process.env['OMNITRON_LOG_DATE_FORMAT'] !== undefined ? process.env['OMNITRON_LOG_DATE_FORMAT'] : 'YYYY-MM-DDTHH:mm:ss',
  ...pathStructure(process.env['OVER_HOME']),
};
