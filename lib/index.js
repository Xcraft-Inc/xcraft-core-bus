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

    const Notifier = require ('./notifier.js');
    const Commander = require ('./commander.js');

    this._token = '';
    this._notifier = new Notifier (this);
    this._commander = new Commander (this);
    this._modules = {};
    this._contexts = {};

    watt.wrapAll (this);
  }

  _registerCommand (name, location, hot, rc, handler) {
    /* register commands as activity */
    this._commander.registerCommandHandler (
      name,
      location,
      hot,
      {
        desc: (rc && rc.desc) || null,
        options: (rc && rc.options) || {},
        activity: true,
        parallel: (rc && rc.parallel) || false,
        delayed: (rc && rc.delayed) || false,
      },
      handler
    );
  }

  /**
   * Browse /scripts for zog modules, and register exported xcraftCommands.
   * (Activities).
   *
   * @param {Resp} resp response object.
   * @param {string} modulePath base module directory.
   * @param {string} moduleHot is hot module.
   * @param {RegExp} filterRegex regex for listing the directory.
   */
  *_loadCommandsRegistry (resp, modulePath, moduleHot, filterRegex) {
    const fileNames = xFs.ls (modulePath, filterRegex);
    try {
      yield this.loadModule (resp, fileNames, modulePath, moduleHot);
    } catch (ex) {
      xLog.warn (ex.stack || ex);
    }
  }

  *_loadRegistry (busClient, commandHandlers, next) {
    /* load some command handler from modules/scripts locations */
    for (const index of Object.keys (commandHandlers)) {
      const resp = busClient.newResponse (moduleName, 'greathall');
      this._loadCommandsRegistry (
        resp,
        commandHandlers[index].path,
        commandHandlers[index].hot,
        commandHandlers[index].pattern,
        next.parallel ()
      );
    }
    yield next.sync ();
  }

  notifyCmdsRegistry () {
    const busClient = require ('xcraft-core-busclient').getGlobal ();
    if (!busClient.isConnected ()) {
      return;
    }

    busClient.events.send (
      'greathall::bus.commands.registry',
      this._commander.getRegistry ()
    );
  }

  _getModules (onlyHot) {
    const registry = this._commander.getRegistry ();
    const list = Object.keys (registry)
      .filter (key => !/^bus\./.test (key))
      .map (key => registry[key]);
    return onlyHot ? list.filter (cmd => cmd.hot && !!cmd.location) : list;
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

  *loadModule (resp, files, root, hot, next) {
    const clearRequire = require ('clear-require');

    if (!files || !files.length || !root) {
      throw new Error (`bad arguments`);
    }

    const loaded = [];

    for (const file of files) {
      const location = path.join (root, file);
      const handle = require (location);
      if (!handle.hasOwnProperty ('xcraftCommands')) {
        clearRequire (location);
        xLog.warn (`skip ${location} which is not a valid Xcraft module`);
        continue;
      }

      const name = file.replace (/\.js$/, '');
      if (this._commander.isModuleRegistered (name)) {
        xLog.warn (
          `skip ${location} because a module with the same name is already registered`
        );
        continue;
      }

      let cmds = {};

      try {
        cmds = handle.xcraftCommands ();
      } catch (ex) {
        clearRequire (location);
        xLog.err (ex.stack || ex);
        continue;
      }
      const rc = cmds.rc || {};

      /* Save location of module */
      this._modules[name] = {hot, location};

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
          this._registerCommand (
            modName,
            location,
            hot,
            rc[cmd],
            cmds.handlers[cmd]
          );
        });

      loaded.push ({name, cmds});
    }

    this.notifyCmdsRegistry ();

    if (!resp) {
      return;
    }

    for (const item of loaded) {
      yield resp.command.send (`${item.name}._postload`, null, next);
      if (item.cmds.context && this._contexts[item.name]) {
        yield item.cmds.context.set (
          item.name,
          this._contexts[item.name],
          resp,
          next
        );
      }
    }
  }

  *unloadModule (resp, names, next) {
    if (!names || !names.length) {
      throw new Error (`bad arguments`);
    }

    for (const name of names) {
      if (!this._commander.isModuleRegistered (name)) {
        xLog.warn (`the module ${name} is not loaded`);
        continue;
      }

      if (resp) {
        yield resp.command.send (`${name}._preunload`, null, next);
      }

      const cmds = require (this._modules[name].location).xcraftCommands ();
      if (cmds.context) {
        this._contexts[name] = cmds.context.get (name);
        delete this._modules[name];
      }
    }

    // FIXME: overkill because it clears the same modules two times
    for (const name of names) {
      this._commander.unregisterModule (name);
    }

    this.notifyCmdsRegistry ();
  }

  *reloadModule (resp, files, root) {
    if (!files || !files.length || !root) {
      throw new Error (`bad arguments`);
    }

    let wasHot = false;

    const names = files.map (file => file.replace (/\.js$/, ''));
    for (const name of names) {
      //FIXME: Package def should be reloaded
      if (!wasHot) {
        wasHot = this._modules[name] && this._modules[name].hot;
      }
    }

    try {
      yield this.unloadModule (resp, names);
    } catch (ex) {
      /* ignore exceptions */
      resp.log.warn (ex.stack || ex);
    }

    yield this.loadModule (resp, files, root, wasHot);
  }

  runningModuleNames (onlyHot) {
    return this._getModules (onlyHot)
      .map (cmd => cmd.name.replace (/(^[^.]*)\..*/, '$1'))
      .reduce ((acc, name) => {
        if (!acc.includes (name)) {
          acc.push (name);
        }
        return acc;
      }, []);
  }

  runningModuleLocations (onlyHot) {
    return this._getModules (onlyHot)
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
      host: busConfig.host,
      commanderPort: this._commander.ports[0], //FIXME: multi-ports backends case
      notifierPort: this._notifier.ports[0], //FIXME: multi-ports backends case
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
