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
  _loadCommandsRegistry (modulePath, filterRegex) {
    xFs
      .ls (modulePath, filterRegex)
      .forEach (fileName => this.loadModule (fileName, modulePath));
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

  loadModule (file, root) {
    if (!file || !root) {
      xLog.err (`bad arguments`);
      return false;
    }

    const location = path.join (root, file);
    const handle = require (location);
    if (!handle.hasOwnProperty ('xcraftCommands')) {
      xLog.verb (`skip ${location} which is not a valid Xcraft module`);
      return false;
    }

    const name = file.replace (/\.js$/, '');
    if (busCommander.isModuleRegistered (name)) {
      xLog.warn (
        `skip ${location} because a module with the same name is already registered`
      );
      return false;
    }

    const cmds = handle.xcraftCommands ();
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
    return true;
  }

  unloadModule (name) {
    if (!name) {
      xLog.err (`bad arguments`);
      return false;
    }

    if (!busCommander.isModuleRegistered (name)) {
      xLog.warn (`the module ${name} is not loaded`);
      return false;
    }

    busCommander.unregisterModule (name);

    this._notifyCmdsRegistry ();
    return true;
  }

  reloadModule (file, root) {
    if (!file || !root) {
      xLog.err (`bad arguments`);
      return false;
    }

    const name = file.replace (/\.js$/, '');
    this.unloadModule (name);
    return this.loadModule (file, root);
  }

  runningModules () {
    const registry = busCommander.getRegistry ();
    return Object.keys (registry)
      .filter (key => !/^bus\./.test (key))
      .map (key => registry[key])
      .filter (cmd => !!cmd.desc)
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

    /* load some command handler from modules/scripts locations */
    Object.keys (commandHandlers).forEach (index => {
      this._loadCommandsRegistry (
        commandHandlers[index].path,
        commandHandlers[index].pattern
      );
    });

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
    this.emit ('ready');
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
