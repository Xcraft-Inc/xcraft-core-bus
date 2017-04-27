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
