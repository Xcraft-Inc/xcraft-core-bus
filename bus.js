'use strict';

const xBus = require('.');

const cmds = {};

let appId = '$';
let tribe = '';
try {
  const xHost = require('xcraft-core-host');
  appId = xHost.appId;
  tribe = xHost.appArgs().tribe ? `-${xHost.appArgs().tribe}` : '';
} catch (ex) {
  if (ex.code !== 'MODULE_NOT_FOUND') {
    throw ex;
  }
}

const cmdNamespace = `${appId}${tribe}`;

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

const heapdump = `${cmdNamespace}.heapdump`;

cmds[heapdump] = async function (msg, resp) {
  try {
    const {mkdtemp} = require('node:fs/promises');
    const {join} = require('node:path');
    const {tmpdir} = require('node:os');
    const {writeHeapSnapshot} = require('node:v8');

    const output = await mkdtemp(join(tmpdir(), 'heap-'));
    const snapshot = join(output, `heapdump.${cmdNamespace}.heapsnapshot`);
    resp.log.dbg('Heap snapshot output: ', snapshot);

    writeHeapSnapshot(snapshot);
    resp.events.send(`bus.${heapdump}.${msg.id}.finished`, snapshot);
  } catch (ex) {
    resp.events.send(`bus.${heapdump}.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

const malloctrim = `${cmdNamespace}.malloctrim`;

cmds[malloctrim] = async function (msg, resp) {
  try {
    if (process.platform !== 'linux') {
      throw new Error(`malloc-trim is only supported on Linux with the glibc`);
    }

    const koffi = require('koffi');
    const libc = koffi.load('libc.so.6');
    const mallocTrim = libc.func('malloc_trim', 'int', ['size_t']);

    const freed = mallocTrim(0);
    resp.events.send(
      `bus.${malloctrim}.${msg.id}.finished`,
      `Heap is ${freed ? 'freed' : 'not freed'}`
    );
  } catch (ex) {
    resp.events.send(`bus.${malloctrim}.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmds.xcraftMetrics = function (msg, resp) {
  const v8 = require('v8');
  const process = require('process');
  const os = require('os');
  const metrics = {};

  try {
    let stats;
    const ns = `${os.hostname()}.${cmdNamespace}`;

    /************************************************************************/

    stats = v8.getHeapStatistics();
    metrics[`${ns}.v8.heap.total`] = stats.total_heap_size;
    metrics[`${ns}.v8.heap.executable.total`] =
      stats.total_heap_size_executable;
    metrics[`${ns}.v8.heap.physical.total`] = stats.total_physical_size;
    metrics[`${ns}.v8.heap.available.total`] = stats.total_available_size;
    metrics[`${ns}.v8.heap.used.total`] = stats.used_heap_size;
    metrics[`${ns}.v8.heap.limit.total`] = stats.heap_size_limit;
    metrics[`${ns}.v8.heap.malloced.total`] = stats.malloced_memory;
    metrics[`${ns}.v8.heap.malloced.peak.total`] = stats.peak_malloced_memory;
    metrics[`${ns}.v8.heap.nativeContexts.total`] =
      stats.number_of_native_contexts; /* If it increases over time, it's a memory leak */
    metrics[`${ns}.v8.heap.detachedContexts.total`] =
      stats.number_of_detached_contexts; /* Potential memory leak */

    /************************************************************************/

    stats = v8.getHeapCodeStatistics();
    metrics[`${ns}.v8.heap.codeMetadata.total`] = stats.code_and_metadata_size;
    metrics[`${ns}.v8.heap.bytecodeMetadata.total`] =
      stats.bytecode_and_metadata_size;
    metrics[`${ns}.v8.heap.scriptSource.total`] =
      stats.external_script_source_size;

    /************************************************************************/

    stats = process.cpuUsage();
    metrics[`${ns}.process.cpuUsage.user.total`] = stats.user; /* us */
    metrics[`${ns}.process.cpuUsage.system.total`] = stats.system; /* us */

    /************************************************************************/

    stats = process.memoryUsage();
    metrics[`${ns}.process.memory.rss.total`] = stats.rss; /* c++ + js */
    metrics[`${ns}.process.memory.heap.total`] =
      stats.heapTotal; /* v8, see above */
    metrics[`${ns}.process.memory.heapUsed.total`] =
      stats.heapUsed; /* v8, see above */
    metrics[`${ns}.process.memory.external.total`] =
      stats.external; /* c++ objects managed by v8 */
    metrics[`${ns}.process.memory.arrayBuffers.total`] =
      stats.arrayBuffers; /* node js Buffers */

    /************************************************************************/

    stats = process.resourceUsage();
    metrics[`${ns}.process.maxrss.total`] = stats.maxRSS; /* KB */
    metrics[`${ns}.process.ixrss.total`] = stats.sharedMemorySize; /* KB */
    metrics[`${ns}.process.idrss.total`] = stats.unsharedDataSize; /* KB */
    metrics[`${ns}.process.isrss.total`] = stats.unsharedStackSize; /* KB */
    metrics[`${ns}.process.pageFault.minor.total`] = stats.minorPageFault;
    metrics[`${ns}.process.pageFault.major.total`] = stats.majorPageFault;
    metrics[`${ns}.process.swappedOut.total`] = stats.swappedOut;
    metrics[`${ns}.process.fs.read.total`] = stats.fsRead;
    metrics[`${ns}.process.fs.write.total`] = stats.fsWrite;
    metrics[`${ns}.process.ipc.sent.total`] = stats.ipcSent;
    metrics[`${ns}.process.ipc.received.total`] = stats.ipcReceived;
    metrics[`${ns}.process.signalsCount.total`] = stats.signalsCount;
    metrics[`${ns}.process.contextSwitches.voluntary.total`] =
      stats.voluntaryContextSwitches;
    metrics[`${ns}.process.contextSwitches.involuntary.total`] =
      stats.involuntaryContextSwitches;

    /************************************************************************/

    metrics[`${ns}.process.uptime.total`] = process.uptime(); /* sec */

    /************************************************************************/

    metrics[`${ns}.os.process.priority.total`] = os.getPriority();
    metrics[`${ns}.os.memory.total`] = os.totalmem();
    metrics[`${ns}.os.uptime.total`] = os.uptime();

    /************************************************************************/
  } finally {
    resp.events.send(`bus.xcraftMetrics.${msg.id}.finished`, metrics);
  }
};

const xcraftMetrics = `${cmdNamespace}.xcraftMetrics`;

cmds[xcraftMetrics] = function* (msg, resp, next) {
  if (msg.data.from === `bus-${cmdNamespace}`) {
    resp.events.send(`bus.${xcraftMetrics}.${msg.id}.finished`);
    return;
  }

  let full = false;
  if (msg.data.from === 'garona') {
    full = true;
  }

  const metrics = {};
  try {
    const registry = full
      ? xBus.getCommander().getFullRegistry()
      : xBus.getRegistry();
    const metricsCommands = Object.keys(registry).filter((cmd) =>
      cmd.endsWith('.xcraftMetrics')
    );
    for (const cmd of metricsCommands) {
      const _metrics = yield resp.command.send(
        cmd,
        {from: `bus-${cmdNamespace}`},
        next
      );
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
      [heapdump]: {
        parallel: true,
        desc: 'dump the server v8 heap',
      },
      [malloctrim]: {
        parallel: true,
        desc: 'try to release free memory at the top of the heap',
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
