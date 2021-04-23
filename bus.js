'use strict';

const path = require('path');
const xBus = require('.');

const cmds = {};
const watched = {};

let appId = '$';
try {
  appId = require('xcraft-core-host').appId;
} catch (ex) {
  if (ex.code !== 'MODULE_NOT_FOUND') {
    throw ex;
  }
}

function getModuleFiles(file) {
  return file ? [file] : xBus.runningModuleLocations(true);
}

function getModuleNames(name) {
  return name ? [name] : xBus.runningModuleNames(true);
}

cmds['module.load'] = function* (msg, resp) {
  const xFs = require('xcraft-core-fs');

  const {moduleName} = msg.data;

  const moduleInfo = xBus.getModuleInfo(moduleName);
  const filenames = xFs.ls(moduleInfo.path, moduleInfo.pattern);

  //READ DEF: FIND HOT
  try {
    yield xBus.loadModule(resp, filenames, moduleInfo.path, {});
    resp.log.info(`module(s) ${filenames.join(', ')} successfully loaded`);
  } catch (ex) {
    resp.log.warn(ex.stack);
  }

  resp.events.send(`bus.module.load.${msg.id}.finished`);
};

cmds['module.unload'] = function* (msg, resp) {
  const {names} = msg.data;
  const modNames = !names.length ? getModuleNames() : names;

  try {
    yield xBus.unloadModule(resp, modNames);
    resp.log.info(`module(s) ${modNames.join(', ')} successfully unloaded`);
  } catch (ex) {
    resp.log.warn(ex.stack);
  }

  resp.events.send(`bus.module.unload.${msg.id}.finished`);
};

cmds['module.reload'] = function* (msg, resp) {
  const {files} = msg.data;
  const modFiles = !files.length ? getModuleFiles() : files;

  const dirname = path.dirname(modFiles[0]);
  const filenames = modFiles.map((file) => path.basename(file));

  try {
    yield xBus.reloadModule(resp, filenames, dirname);
    resp.log.info(`module(s) ${filenames.join(', ')} successfully reloaded`);
  } catch (ex) {
    resp.log.err(ex.stack);
  }

  resp.events.send(`bus.module.reload.${msg.id}.finished`);
};

cmds['module.watch'] = function* (msg, resp, next) {
  const chokidar = require('chokidar');
  const {file} = msg.data;
  const files = getModuleFiles(file);

  const dirList = new Set();

  for (const file of files) {
    const dirname = path.dirname(file);

    if (dirList.has(dirname)) {
      continue;
    }

    dirList.add(dirname);

    if (watched[dirname]) {
      watched[dirname].handle.close();
    }

    const _next = next.parallel();

    watched[dirname] = {
      handle: chokidar
        .watch(dirname)
        .on('all', (event, location) => {
          if (!watched[dirname].ready) {
            return;
          }

          resp.log.info(`file ${location} has changed, reload...`);
          const modFiles = files.filter((file) => file.startsWith(dirname));
          resp.command.send('bus.module.reload', {files: modFiles}, () => {});
        })
        .on('ready', () => {
          watched[dirname].ready = true;
          _next();
        })
        .on('error', (err) => {
          resp.log.err(err);
          _next(err);
        }),
      ready: false,
    };
  }

  yield next.sync();

  resp.log.verb(`watched modules: ${Object.keys(watched).join(', ')}`);
  resp.events.send(`bus.module.watch.${msg.id}.finished`);
};

cmds['module.unwatch'] = function (msg, resp) {
  const {file} = msg.data;
  const dirnames = getModuleFiles(file).map((file) => path.dirname(file));

  dirnames
    .filter((dirname) => !!watched[dirname])
    .forEach((dirname) => {
      resp.log.info(`stop watching for ${dirname}`);
      watched[dirname].handle.close();
      delete watched[dirname];
    });

  resp.log.verb(`watched modules: ${Object.keys(watched).join(', ')}`);
  resp.events.send(`bus.module.unwatch.${msg.id}.finished`);
};

cmds.xcraftMetrics = function (msg, resp) {
  const v8 = require('v8');
  const process = require('process');
  const os = require('os');
  const metrics = {};

  try {
    let stats;

    /************************************************************************/

    stats = v8.getHeapStatistics();
    metrics[`v8.heap.total`] = stats.total_heap_size;
    metrics[`v8.heap.executable.total`] = stats.total_heap_size_executable;
    metrics[`v8.heap.physical.total`] = stats.total_physical_size;
    metrics[`v8.heap.available.total`] = stats.total_available_size;
    metrics[`v8.heap.used.total`] = stats.used_heap_size;
    metrics[`v8.heap.limit.total`] = stats.heap_size_limit;
    metrics[`v8.heap.malloced.total`] = stats.malloced_memory;
    metrics[`v8.heap.malloced.peak.total`] = stats.peak_malloced_memory;
    metrics[`v8.heap.nativeContexts.total`] =
      stats.number_of_native_contexts; /* If it increases over time, it's a memory leak */
    metrics[`v8.heap.detachedContexts.total`] =
      stats.number_of_detached_contexts; /* Potential memory leak */

    /************************************************************************/

    stats = v8.getHeapCodeStatistics();
    metrics[`v8.heap.codeMetadata.total`] = stats.code_and_metadata_size;
    metrics[`v8.heap.bytecodeMetadata.total`] =
      stats.bytecode_and_metadata_size;
    metrics[`v8.heap.scriptSource.total`] = stats.external_script_source_size;

    /************************************************************************/

    stats = process.cpuUsage();
    metrics[`process.cpuUsage.user.total`] = stats.user; /* us */
    metrics[`process.cpuUsage.system.total`] = stats.system; /* us */

    /************************************************************************/

    stats = process.memoryUsage();
    metrics[`process.memory.rss.total`] = stats.rss; /* c++ + js */
    metrics[`process.memory.heap.total`] = stats.heapTotal; /* v8, see above */
    metrics[`process.memory.heapUsed.total`] =
      stats.heapUsed; /* v8, see above */
    metrics[`process.memory.external.total`] =
      stats.external; /* c++ objects managed by v8 */
    metrics[`process.memory.arrayBuffers.total`] =
      stats.arrayBuffers; /* node js Buffers */

    /************************************************************************/

    stats = process.resourceUsage();
    metrics[`process.maxrss.total`] = stats.maxRSS; /* KB */
    metrics[`process.ixrss.total`] = stats.sharedMemorySize; /* KB */
    metrics[`process.idrss.total`] = stats.unsharedDataSize; /* KB */
    metrics[`process.isrss.total`] = stats.unsharedStackSize; /* KB */
    metrics[`process.pageFault.minor.total`] = stats.minorPageFault;
    metrics[`process.pageFault.major.total`] = stats.majorPageFault;
    metrics[`process.swappedOut.total`] = stats.swappedOut;
    metrics[`process.fs.read.total`] = stats.fsRead;
    metrics[`process.fs.write.total`] = stats.fsWrite;
    metrics[`process.ipc.sent.total`] = stats.ipcSent;
    metrics[`process.ipc.received.total`] = stats.ipcReceived;
    metrics[`process.signalsCount.total`] = stats.signalsCount;
    metrics[`process.contextSwitches.voluntary.total`] =
      stats.voluntaryContextSwitches;
    metrics[`process.contextSwitches.involuntary.total`] =
      stats.involuntaryContextSwitches;

    /************************************************************************/

    metrics[`process.uptime.total`] = process.uptime(); /* sec */

    /************************************************************************/

    metrics[`os.process.priority.total`] = os.getPriority();
    metrics[`os.memory.total`] = os.totalmem();
    metrics[`os.uptime.total`] = os.uptime();

    /************************************************************************/
  } finally {
    resp.events.send(`bus.xcraftMetrics.${msg.id}.finished`, metrics);
  }
};

const xcraftMetrics = `${appId}.xcraftMetrics`;

cmds[xcraftMetrics] = function* (msg, resp, next) {
  if (msg.data.from === 'bus') {
    resp.events.send(`bus.${xcraftMetrics}.${msg.id}.finished`);
    return;
  }

  const metrics = {};
  try {
    const registry = xBus.getRegistry();
    const metricsCommands = Object.keys(registry).filter((cmd) =>
      cmd.endsWith('.xcraftMetrics')
    );
    for (const cmd of metricsCommands) {
      const _metrics = yield resp.command.send(cmd, {from: 'bus'}, next);
      Object.assign(metrics, _metrics.data);
    }
  } finally {
    resp.events.send(`bus.${xcraftMetrics}.${msg.id}.finished`, metrics);
  }
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmds,
    rc: {
      'module.load': {
        parallel: false,
        desc: 'load a module',
        options: {
          params: {
            required: 'moduleName',
          },
        },
      },
      'module.unload': {
        parallel: false,
        desc: 'unload a module',
        options: {
          params: {
            optional: 'names...',
          },
        },
      },
      'module.reload': {
        parallel: false,
        desc: 'reload a module',
        options: {
          params: {
            optional: 'files...',
          },
        },
      },
      'module.watch': {
        parallel: true,
        desc: 'start watching for module auto-reload',
        options: {
          params: {
            optional: 'file',
          },
        },
      },
      'module.unwatch': {
        parallel: true,
        desc: 'stop watching for module auto-reload',
        options: {
          params: {
            optional: 'file',
          },
        },
      },
      'xcraftMetrics': {
        parallel: true,
        desc: 'extract server Xcraft metrics',
      },
      [xcraftMetrics]: {
        parallel: true,
        desc: 'extract all Xcraft metrics',
      },
    },
  };
};
