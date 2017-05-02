'use strict';

const moduleName = 'bus';

const path = require ('path');
const watt = require ('watt');
const orcish = require ('./lib/orcish.js');

const busNotifier = require ('./lib/notifier.js');
const busCommander = require ('./lib/commander.js');

const xFs = require ('xcraft-core-fs');
const xLog = require ('xcraft-core-log') (moduleName, null);
const busConfig = require ('xcraft-core-etc') ().load ('xcraft-core-bus');

const {EventEmitter} = require ('events');

class Bus extends EventEmitter {
  constructor () {
    super ();

    this._token = '';
    this._notifier = {};
    this._commander = {};

    watt.wrapAll (this);
  }

  static _registerCommand (name, location, rc, handler) {
    /* register commands as activity */
    busCommander.registerCommandHandler (
      name,
      location,
      (rc && rc.desc) || null,
      (rc && rc.options) || {},
      true,
      (rc && rc.parallel) || false,
      handler
    );
  }

  /**
   * Browse /scripts for zog modules, and register exported xcraftCommands.
   * (Activities).
   */
  *_loadCommandsRegistry (resp, modulePath, filterRegex) {
    for (const fileName of xFs.ls (modulePath, filterRegex)) {
      try {
        yield this.loadModule (resp, fileName, modulePath);
      } catch (ex) {
        xLog.warn (ex.message);
      }
    }
  }

  _notifyCmdsRegistry () {
    const busClient = require ('xcraft-core-busclient').getGlobal ();
    if (!busClient.isConnected ()) {
      return;
    }

    busClient.events.send (
      'greathall::bus.commands.registry',
      busCommander.getRegistry ()
    );
  }

  _runningModules () {
    const registry = busCommander.getRegistry ();
    return Object.keys (registry)
      .filter (key => !/^bus\./.test (key))
      .map (key => registry[key])
      .filter (cmd => !!cmd.desc);
  }

  generateOrcName () {
    return orcish.generateOrcName ();
  }

  getCommander () {
    return this._commander;
  }

  getNotifier () {
    return this._notifier;
  }

  getToken () {
    return this._token;
  }

  *loadModule (resp, file, root, next) {
    const clearRequire = require ('clear-require');

    if (!file || !root) {
      throw new Error (`bad arguments`);
    }

    const location = path.join (root, file);
    const handle = require (location);
    if (!handle.hasOwnProperty ('xcraftCommands')) {
      clearRequire (location);
      throw new Error (`skip ${location} which is not a valid Xcraft module`);
    }

    const name = file.replace (/\.js$/, '');
    if (busCommander.isModuleRegistered (name)) {
      throw new Error (
        `skip ${location} because a module with the same name is already registered`
      );
    }

    let cmds = {};

    try {
      cmds = handle.xcraftCommands ();
    } catch (ex) {
      clearRequire (location);
      throw new Error (ex);
    }
    const rc = cmds.rc || {};

    /* If at least one command is already registered, this module is
     * fully skipped.
     */
    Object.keys (cmds.handlers)
      .map (cmd => {
        if (busCommander.isCommandRegistered (cmd)) {
          throw new Error (`command ${cmd} already registered`);
        }
        return cmd;
      })
      .forEach (cmd => {
        const modName = `${name}.${cmd}`;
        Bus._registerCommand (modName, location, rc[cmd], cmds.handlers[cmd]);
      });

    this._notifyCmdsRegistry ();

    if (resp) {
      yield resp.command.send (`${name}._postload`, null, next);
    }
  }

  *unloadModule (resp, name, next) {
    if (!name) {
      throw new Error (`bad arguments`);
    }

    if (!busCommander.isModuleRegistered (name)) {
      throw new Error (`the module ${name} is not loaded`);
    }

    if (resp) {
      yield resp.command.send (`${name}._preunload`, null, next);
    }

    busCommander.unregisterModule (name);

    this._notifyCmdsRegistry ();
  }

  *reloadModule (resp, file, root) {
    if (!file || !root) {
      throw new Error (`bad arguments`);
    }

    const name = file.replace (/\.js$/, '');
    try {
      yield this.unloadModule (resp, name);
    } catch (ex) {
      /* ignore exceptions */
    }
    yield this.loadModule (resp, file, root);
  }

  runningModuleNames () {
    return this._runningModules ()
      .map (cmd => cmd.name.replace (/(^[^.]*)\..*/, '$1'))
      .reduce ((acc, name) => {
        if (!acc.includes (name)) {
          acc.push (name);
        }
        return acc;
      }, []);
  }

  runningModuleLocations () {
    return this._runningModules ()
      .map (cmd => cmd.location)
      .reduce ((acc, location) => {
        if (!acc.includes (location)) {
          acc.push (location);
        }
        return acc;
      }, []);
  }

  /**
   * Boot buses.
   *
   * @param {Object[]} commandHandlers - List of modules.
   * @param {function(err)} next
   */
  *boot (commandHandlers, next) {
    xLog.verb ('Booting...');

    /* Generate the token */
    const genToken = yield orcish.generateGreatHall (next);
    xLog.info ('Great Hall created: %s', genToken);
    this._token = genToken;

    /* Start the bus commander */
    busCommander.start (
      busConfig.host,
      parseInt (busConfig.commanderPort),
      genToken,
      next.parallel ()
    );

    /* Start the bus notifier */
    busNotifier.start (
      busConfig.host,
      parseInt (busConfig.notifierPort),
      next.parallel ()
    );

    yield next.sync ();

    this._notifier = busNotifier.bus;
    this._commander = busCommander;

    this.emit ('ready', (busClient, callback) => {
      /* load some command handler from modules/scripts locations */
      Object.keys (commandHandlers).forEach (index => {
        const resp = busClient.newResponse (moduleName, 'greathall');
        this._loadCommandsRegistry (
          resp,
          commandHandlers[index].path,
          commandHandlers[index].pattern
        );
      });

      callback ();
    });
  }

  stop () {
    xLog.verb ('Buses stop called, stopping services and sending GameOver...');

    const busClient = require ('xcraft-core-busclient').getGlobal ();
    const msg = busClient.newMessage ();
    this._notifier.send ('gameover', msg);

    this.emit ('stop');
    busCommander.stop ();
    busNotifier.stop ();
  }
}

module.exports = new Bus ();
