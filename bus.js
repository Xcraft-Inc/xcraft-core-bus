'use strict';

const path = require ('path');
const xBus = require ('.');

const cmds = {};

cmds['module.load'] = function (msg, resp) {
  const location = msg.data.file;
  const file = path.basename (location);
  const root = path.dirname (location);

  try {
    if (xBus.loadModule (file, root)) {
      resp.log.info (`module ${location} successfully loaded`);
    } else {
      resp.log.warn (`cannot load module ${location}`);
    }
  } catch (ex) {
    resp.log.err (ex.message);
  }

  resp.events.send ('bus.module.load.finished');
};

cmds['module.unload'] = function (msg, resp) {
  const {name} = msg.data;

  try {
    if (xBus.unloadModule (name)) {
      resp.log.info (`module ${name} successfully unloaded`);
    } else {
      resp.log.warn (`cannot unload module ${name}`);
    }
  } catch (ex) {
    resp.log.err (ex.message);
  }

  resp.events.send ('bus.module.unload.finished');
};

cmds['module.reload'] = function (msg, resp) {
  const location = msg.data.file;
  const file = path.basename (location);
  const root = path.dirname (location);

  try {
    if (xBus.reloadModule (file, root)) {
      resp.log.info (`module ${location} successfully reloaded`);
    } else {
      resp.log.warn (`cannot reload module ${location}`);
    }
  } catch (ex) {
    resp.log.err (ex.message);
  }

  resp.events.send ('bus.module.reload.finished');
};

const watched = {};

function getModulesList (file) {
  return file ? [file] : xBus.runningModules ();
}

cmds['module.watch'] = function* (msg, resp, next) {
  const chokidar = require ('chokidar');
  const {file} = msg.data;
  const files = getModulesList (file);

  for (const file of files) {
    const dirname = path.dirname (file);

    if (watched[dirname]) {
      watched[dirname].handle.close ();
    }

    const _next = next.parallel ();

    watched[dirname] = {
      handle: chokidar
        .watch (dirname)
        .on ('all', (event, location) => {
          if (!watched[dirname].ready) {
            return;
          }

          resp.log.info (`file ${location} has changed, reload...`);
          resp.command.send ('bus.module.reload', {file}, () => {});
        })
        .on ('ready', () => {
          watched[dirname].ready = true;
          _next ();
        })
        .on ('error', err => {
          resp.log.err (err);
          _next (err);
        }),
      ready: false,
    };
  }

  yield next.sync ();

  resp.log.verb (`watched modules: ${Object.keys (watched).join (', ')}`);
  resp.events.send ('bus.module.watch.finished');
};

cmds['module.unwatch'] = function (msg, resp) {
  const {file} = msg.data;
  const dirnames = getModulesList (file);

  dirnames.filter (dirname => !!watched[dirname]).forEach (dirname => {
    resp.log.info (`stop watching for ${file}`);
    watched[dirname].handle.close ();
    delete watched[dirname];
  });

  resp.log.verb (`watched modules: ${Object.keys (watched).join (', ')}`);
  resp.events.send ('bus.module.unwatch.finished');
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  const path = require ('path');
  const xUtils = require ('xcraft-core-utils');
  return {
    handlers: cmds,
    rc: xUtils.json.fromFile (path.join (__dirname, './rc.json')),
  };
};
