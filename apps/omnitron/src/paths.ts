import fs from 'fs';
import p from 'path';

const getDefaultOMNITRONHome = () => {
  let OMNITRON_ROOT_PATH;

  if (process.env['OMNITRON_HOME']) OMNITRON_ROOT_PATH = process.env['OMNITRON_HOME'];
  else if (process.env['HOME'] && !process.env['HOMEPATH']) OMNITRON_ROOT_PATH = p.resolve(process.env['HOME'], '.omnitron');
  else if (process.env['HOME'] || process.env['HOMEPATH'])
    OMNITRON_ROOT_PATH = p.resolve(
      process.env['HOMEDRIVE'] || '',
      (process.env['HOME'] || process.env['HOMEPATH'])!,
      '.omnitron'
    );
  else {
    console.error('[OMNITRON][Initialization] Environment variable HOME (Linux) or HOMEPATH (Windows) are not set!');
    console.error('[OMNITRON][Initialization] Defaulting to /etc/.omnitron');
    OMNITRON_ROOT_PATH = p.resolve('/etc', '.omnitron');
  }

  return OMNITRON_ROOT_PATH;
};

export default (OMNITRON_HOME?: string) => {
  let has_node_embedded = false;

  if (fs.existsSync(p.resolve(__dirname, './node')) === true) {
    has_node_embedded = true;
  }

  const home = OMNITRON_HOME || getDefaultOMNITRONHome();

  const omnitron_file_stucture = {
    OMNITRON_HOME: home,
    OMNITRON_ROOT_PATH: home,

    OMNITRON_CONF_FILE: p.resolve(home, 'conf.js'),
    OMNITRON_MODULE_CONF_FILE: p.resolve(home, 'module_conf.json'),

    OMNITRON_LOG_FILE_PATH: p.resolve(home, 'omnitron.log'),
    OMNITRON_PID_FILE_PATH: p.resolve(home, 'omnitron.pid'),

    OMNITRON_RELOAD_LOCKFILE: p.resolve(home, 'reload.lock'),

    DEFAULT_PID_PATH: p.resolve(home, 'pids'),
    DEFAULT_LOG_PATH: p.resolve(home, 'logs'),
    DEFAULT_MODULE_PATH: p.resolve(home, 'modules'),
    OMNITRON_IO_ACCESS_TOKEN: p.resolve(home, 'omnitron-io-token'),
    DUMP_FILE_PATH: p.resolve(home, 'dump.omnitron'),
    DUMP_BACKUP_FILE_PATH: p.resolve(home, 'dump.omnitron.bak'),

    DAEMON_RPC_PORT: p.resolve(home, 'rpc.sock'),
    DAEMON_PUB_PORT: p.resolve(home, 'pub.sock'),
    INTERACTOR_RPC_PORT: p.resolve(home, 'interactor.sock'),

    INTERACTOR_LOG_FILE_PATH: p.resolve(home, 'agent.log'),
    INTERACTOR_PID_PATH: p.resolve(home, 'agent.pid'),
    INTERACTION_CONF: p.resolve(home, 'agent.json5'),

    HAS_NODE_EMBEDDED: has_node_embedded,
    BUILTIN_NODE_PATH: has_node_embedded === true ? p.resolve(__dirname, './node/bin/node') : null,
    BUILTIN_NPM_PATH: has_node_embedded === true ? p.resolve(__dirname, './node/bin/npm') : null,
  };

  // allow overide of file paths via environnement
  const paths = Object.keys(omnitron_file_stucture);
  paths.forEach((key) => {
    const envKey = key.indexOf('OMNITRON_') > -1 ? key : 'OMNITRON_' + key;
    if (process.env[envKey] && key !== 'OMNITRON_HOME' && key !== 'OMNITRON_ROOT_PATH') {
      omnitron_file_stucture[key] = process.env[envKey];
    }
  });

  if (process.platform === 'win32') {
    //@todo instead of static unique rpc/pub file custom with OMNITRON_HOME or UID
    omnitron_file_stucture.DAEMON_RPC_PORT = '\\\\.\\pipe\\rpc.sock';
    omnitron_file_stucture.DAEMON_PUB_PORT = '\\\\.\\pipe\\pub.sock';
    omnitron_file_stucture.INTERACTOR_RPC_PORT = '\\\\.\\pipe\\interactor.sock';
  }

  return omnitron_file_stucture;
};
