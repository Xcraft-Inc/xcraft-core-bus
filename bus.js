'use strict';

const path = require ('path');
const xBus = require ('.');

const cmds = {};
const watched = {};

function getModuleFiles (file) {
  return file ? [file] : xBus.runningModuleLocations ();
}

function getModuleNames (name) {
  return name ? [name] : xBus.runningModuleNames ();
}

cmds['module.load'] = function (msg, resp) {
  const {file} = msg.data;
  const files = getModuleFiles (file);

  files.forEach (file => {
    const filename = path.basename (file);
    const dirname = path.dirname (file);

    try {
      xBus.loadModule (filename, dirname);
      resp.log.info (`module ${filename} successfully loaded`);
    } catch (ex) {
      resp.log.warn (ex.message);
    }
  });

  resp.events.send ('bus.module.load.finished');
};

cmds['module.unload'] = function (msg, resp) {
  const {name} = msg.data;
  const names = getModuleNames (name);

  names.forEach (name => {
    try {
      xBus.unloadModule (name);
      resp.log.info (`module ${name} successfully unloaded`);
    } catch (ex) {
      resp.log.warn (ex.message);
    }
  });

  resp.events.send ('bus.module.unload.finished');
};

cmds['module.reload'] = function (msg, resp) {
  const {file} = msg.data;
  const files = getModuleFiles (file);

  files.forEach (file => {
    const filename = path.basename (file);
    const dirname = path.dirname (file);

    try {
      xBus.reloadModule (filename, dirname);
      resp.log.info (`module ${filename} successfully reloaded`);
    } catch (ex) {
      resp.log.err (ex.message);
    }
  });

  resp.events.send ('bus.module.reload.finished');
};

cmds['module.watch'] = function* (msg, resp, next) {
  const chokidar = require ('chokidar');
  const {file} = msg.data;
  const files = getModuleFiles (file);

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
  const dirnames = getModuleFiles (file);

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
