const eachLimit = require('async/eachLimit');
const forEachLimit = require('async/forEachLimit');

const { Configuration } = require('../../configuration');
const cst = require('../../constants').default;
const NPM = require('./npm');
const TAR = require('./tar');
const LOCAL = require('./local');
const { Common } = require('../../common');

const Modularizer = (module.exports = {});

/**
 * OMNITRON Module System.
 */
Modularizer.install = function (CLI, module_name, opts, cb) {
  module_name = module_name.replace(/[;`|]/g, '');
  if (typeof opts == 'function') {
    cb = opts;
    opts = {};
  }

  if (LOCAL.INTERNAL_MODULES.hasOwnProperty(module_name)) {
    Common.logMod(`Adding dependency ${module_name} to OMNITRON Runtime`);
    var currentModule = LOCAL.INTERNAL_MODULES[module_name];
    if (currentModule && currentModule.hasOwnProperty('dependencies')) {
      LOCAL.installMultipleModules(currentModule.dependencies, cb);
    } else {
      LOCAL.install(currentModule, cb);
    }
  } else if (module_name == '.') {
    Common.logMod(`Installing local NPM module`);
    return NPM.localStart(CLI, opts, cb);
  } else if (opts.tarball || /\.tar\.gz$/i.test(module_name)) {
    Common.logMod(`Installing TAR module`);
    TAR.install(CLI, module_name, opts, cb);
  } else {
    Common.logMod(`Installing NPM ${module_name} module`);
    NPM.install(CLI, module_name, opts, cb);
  }
};

/**
 * Launch All Modules
 * Used OMNITRON at startup
 */
Modularizer.launchModules = function (CLI, cb) {
  var modules = Modularizer.listModules();

  if (!modules) return cb();

  // 1#
  function launchNPMModules(cb_) {
    if (!modules.npm_modules) return launchTARModules(cb_);

    eachLimit(
      Object.keys(modules.npm_modules),
      1,
      function (module_name, next) {
        NPM.start(CLI, modules, module_name, next);
      },
      function () {
        launchTARModules(cb_);
      }
    );
  }

  // 2#
  function launchTARModules(cb_) {
    if (!modules.tar_modules) return cb_();

    eachLimit(
      Object.keys(modules.tar_modules),
      1,
      function (module_name, next) {
        TAR.start(CLI, module_name, next);
      },
      function () {
        return cb_ ? cb_(null) : false;
      }
    );
  }

  launchNPMModules(cb);
};

Modularizer.package = function (CLI, module_path, cb) {
  var fullpath = process.cwd();
  if (module_path) fullpath = require('path').resolve(module_path);
  TAR.packager(fullpath, process.cwd(), cb);
};

/**
 * Uninstall module
 */
Modularizer.uninstall = function (CLI, module_name, cb) {
  Common.printOut(cst.PREFIX_MSG_MOD + 'Uninstalling module ' + module_name);
  var modules_list = Modularizer.listModules();

  if (module_name == 'all') {
    if (!modules_list) return cb();

    return forEachLimit(
      Object.keys(modules_list.npm_modules),
      1,
      function (module_name, next) {
        NPM.uninstall(CLI, module_name, next);
      },
      () => {
        forEachLimit(
          Object.keys(modules_list.tar_modules),
          1,
          function (module_name, next) {
            TAR.uninstall(CLI, module_name, next);
          },
          cb
        );
      }
    );
  }

  if (modules_list.npm_modules[module_name]) {
    NPM.uninstall(CLI, module_name, cb);
  } else if (modules_list.tar_modules[module_name]) {
    TAR.uninstall(CLI, module_name, cb);
  } else {
    Common.errMod('Unknown module');
    CLI.exitCli(1);
  }
};

/**
 * List modules based on modules present in ~/.omnitron/modules/ folder
 */
Modularizer.listModules = function () {
  return {
    npm_modules: Configuration.getSync(cst.MODULE_CONF_PREFIX) || {},
    tar_modules: Configuration.getSync(cst.MODULE_CONF_PREFIX_TAR) || {},
  };
};

Modularizer.getAdditionalConf = function (app_name) {
  return NPM.getModuleConf(app_name);
};

Modularizer.publish = function (OMNITRON, folder, opts, cb) {
  if (opts.npm == true) {
    NPM.publish(opts, cb);
  } else {
    TAR.publish(OMNITRON, folder, cb);
  }
};

Modularizer.generateSample = function (app_name, cb) {
  NPM.generateSample(app_name, cb);
};
