'use strict';

const moduleName = 'bus';

const path = require ('path');
const watt = require ('watt');
const orcish = require ('./orcish.js');

const xFs = require ('xcraft-core-fs');
const xLog = require ('xcraft-core-log') (moduleName, null);
const xEtc = require ('xcraft-core-etc') ();
const busConfig = xEtc.load ('xcraft-core-bus');

const {EventEmitter} = require ('events');

class Bus extends EventEmitter {
  constructor () {
    super ();

    this._token = '';
    this._notifier = require ('./notifier.js');
    this._commander = require ('./commander.js');

    watt.wrapAll (this);
  }

  _registerCommand (name, location, rc, handler) {
    /* register commands as activity */
    this._commander.registerCommandHandler (
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
   *
   * @param {Resp} resp response object.
   * @param {string} modulePath base module directory.
   * @param {RegExp} filterRegex regex for listing the directory.
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

  *_loadRegistry (busClient, commandHandlers, next) {
    /* load some command handler from modules/scripts locations */
    for (const index of Object.keys (commandHandlers)) {
      const resp = busClient.newResponse (moduleName, 'greathall');
      this._loadCommandsRegistry (
        resp,
        commandHandlers[index].path,
        commandHandlers[index].pattern,
        next.parallel ()
      );
    }
    yield next.sync ();
  }

  _notifyCmdsRegistry () {
    const busClient = require ('xcraft-core-busclient').getGlobal ();
    if (!busClient.isConnected ()) {
      return;
    }

    busClient.events.send (
      'greathall::bus.commands.registry',
      this._commander.getRegistry ()
    );
  }

  _runningModules () {
    const registry = this._commander.getRegistry ();
    return Object.keys (registry)
      .filter (key => !/^bus\./.test (key))
      .map (key => registry[key])
      .filter (cmd => !!cmd.desc && !!cmd.location);
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
    if (this._commander.isModuleRegistered (name)) {
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
        if (this._commander.isCommandRegistered (cmd)) {
          throw new Error (`command ${cmd} already registered`);
        }
        return cmd;
      })
      .forEach (cmd => {
        const modName = `${name}.${cmd}`;
        this._registerCommand (modName, location, rc[cmd], cmds.handlers[cmd]);
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

    if (!this._commander.isModuleRegistered (name)) {
      throw new Error (`the module ${name} is not loaded`);
    }

    if (resp) {
      yield resp.command.send (`${name}._preunload`, null, next);
    }

    this._commander.unregisterModule (name);

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
      resp.log.warn (ex.stack || ex);
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
   * @param {Object[]} commandHandlers list of modules.
   * @param {function(err)} next watt's callback.
   */
  *boot (commandHandlers, next) {
    xLog.verb ('Booting...');

    /* Generate the token */
    const genToken = yield orcish.generateGreatHall (next);
    xLog.info ('Great Hall created: %s', genToken);
    this._token = genToken;

    /* Start the bus commander */
    this._commander.start (
      busConfig.host,
      parseInt (busConfig.commanderPort),
      genToken,
      next.parallel ()
    );

    /* Start the bus notifier */
    this._notifier.start (
      busConfig.host,
      parseInt (busConfig.notifierPort),
      next.parallel ()
    );

    yield next.sync ();

    xEtc.saveRun ('xcraft-core-bus', {
      commanderPort: this._commander.options.port,
      notifierPort: this._notifier.options.port,
    });

    this.emit ('ready', (busClient, callback) =>
      this._loadRegistry (busClient, commandHandlers, callback)
    );
  }

  stop () {
    xLog.verb ('Buses stop called, stopping services and sending GameOver...');

    const busClient = require ('xcraft-core-busclient').getGlobal ();
    const msg = busClient.newMessage ();
    this._notifier.send ('gameover', msg);

    this._commander.stop ();
    this._notifier.stop ();
    this.emit ('stop');
  }
}

module.exports = new Bus ();
