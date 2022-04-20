'use strict';

const moduleName = 'bus';

const path = require('path');
const watt = require('gigawatts');
const orcish = require('./orcish.js');

const xFs = require('xcraft-core-fs');
const xLog = require('xcraft-core-log')(moduleName, null);
const xEtc = require('xcraft-core-etc')();
const busConfig = xEtc.load('xcraft-core-bus');

const {EventEmitter} = require('events');

class Bus extends EventEmitter {
  constructor() {
    super();

    const Notifier = require('./notifier.js');
    const Commander = require('./commander.js');

    const acceptIncoming = !!busConfig.acceptIncoming;

    this._token = '';
    this._notifier = new Notifier('greathall', acceptIncoming);
    this._commander = new Commander('greathall', acceptIncoming);
    this._modules = {};
    this._contexts = {};
    this._loaded = false;

    this._commander
      .onInsertOrc((orcName) => {
        /* We ignore orcs which come from the autoconnect first step */
        if (orcName.indexOf('@') !== -1) {
          const busClient = require('xcraft-core-busclient').getGlobal();
          busClient.events.send('greathall::<axon-orc-added>', orcName, null, {
            router: 'ee',
            originRouter: 'ee',
          });
        }
      })
      .onDeleteOrc((orcName) => {
        const busClient = require('xcraft-core-busclient').getGlobal();
        busClient.events.send('greathall::<axon-orc-removed>', orcName, null, {
          router: 'ee',
          originRouter: 'ee',
        });
      });

    watt.wrapAll(this);
  }

  get loaded() {
    return this._loaded;
  }

  _registerCommand(name, location, info, rc, handler) {
    /* register commands as activity */
    this._commander.registerCommandHandler(
      name,
      location,
      info,
      {
        desc: (rc && rc.desc) || null,
        options: (rc && rc.options) || {},
        activity: true,
        parallel: (rc && rc.parallel) || false,
        registrar: (rc && rc.registrar) || 'xcraft-core-bus',
        questOptions: (rc && rc.questOptions) || {},
      },
      handler
    );
  }

  /**
   * Browse /scripts for zog modules, and register exported xcraftCommands.
   * (Activities).
   *
   * @param {Resp} resp response object.
   * @param {string} moduleName module's name.
   * @param {string} modulePath base module directory.
   * @param {string} moduleHot is hot module.
   * @param {string} moduleVersion package module version.
   * @param {RegExp} filterRegex regex for listing the directory.
   */
  *_loadCommandsRegistry(
    resp,
    moduleName,
    modulePath,
    moduleHot,
    moduleVersion,
    filterRegex
  ) {
    const fileNames = xFs.ls(modulePath, filterRegex);
    try {
      yield this.loadModule(resp, fileNames, modulePath, {
        name: moduleName,
        version: moduleVersion,
        hot: moduleHot,
      });
    } catch (ex) {
      xLog.warn(ex.stack || ex);
    }
  }

  *_loadRegistry(busClient, commandHandlers, next) {
    /* load some command handler from modules/scripts locations */
    for (const index of Object.keys(commandHandlers)) {
      const resp = busClient.newResponse(moduleName, 'greathall');
      this._loadCommandsRegistry(
        resp,
        commandHandlers[index].name,
        commandHandlers[index].path,
        commandHandlers[index].hot,
        commandHandlers[index].version,
        commandHandlers[index].pattern,
        next.parallel()
      );
    }
    yield next.sync();

    this._loaded = true;
    busClient.events.send('greathall::loaded');
  }

  acceptIncoming() {
    this._notifier.acceptIncoming();
    this._commander.acceptIncoming();
  }

  /* It can be the current commands registry or from the horde */
  notifyCmdsRegistry() {
    const busClient = require('xcraft-core-busclient').getGlobal();
    if (!busClient.isConnected()) {
      return;
    }

    const registry = this._commander.getFullRegistry();
    busClient.events.send('greathall::bus.commands.registry', {
      registry,
      token: this._token,
    });
  }

  /* It can be the current server token or from the horde */
  notifyTokenChanged() {
    const busClient = require('xcraft-core-busclient').getGlobal();
    if (!busClient.isConnected()) {
      return;
    }

    busClient.events.send('greathall::bus.token.changed');
  }

  notifyOrcnameChanged(oldOrcName, newOrcName) {
    const busClient = require('xcraft-core-busclient').getGlobal();
    if (!busClient.isConnected()) {
      return;
    }

    busClient.events.send('greathall::bus.orcname.changed', {
      oldOrcName,
      newOrcName,
      token: this.getToken(),
    });
  }

  notifyReconnect(status) {
    const busClient = require('xcraft-core-busclient').getGlobal();
    if (!busClient.isConnected()) {
      return;
    }

    busClient.events.send('greathall::bus.reconnect', {status});
  }

  _getModules(onlyHot) {
    const registry = this._commander.getRegistry();
    const list = Object.keys(registry)
      .filter((key) => !/^bus\./.test(key))
      .map((key) => registry[key]);
    return onlyHot
      ? list.filter((cmd) => cmd.info.hot && !!cmd.location)
      : list;
  }

  getModuleInfo(name, userModulePath) {
    let location;
    if (!userModulePath) {
      location = require
        .resolve(path.join(name, 'package.json'))
        .replace(new RegExp(`(.*[/\\\\]${name})[/\\\\].*`), '$1');
    } else {
      location = path
        .join(userModulePath, name, 'package.json')
        .replace(new RegExp(`(.*[/\\\\]${name})[/\\\\].*`), '$1');
    }
    return {
      path: location,
      pattern: /^(?!config\.js|\.).*\.js$/,
    };
  }

  generateOrcName() {
    return orcish.generateOrcName(this.getToken());
  }

  getCommander() {
    return this._commander;
  }

  getNotifier() {
    return this._notifier;
  }

  getToken() {
    return this._token;
  }

  getRegistry() {
    return this._commander.getRegistry();
  }

  getBusTokenFromId(cmd, id) {
    const routingKey = this._commander.getRoutingKeyFromId(cmd, id);
    if (routingKey) {
      const xHorde = require('xcraft-core-horde');
      const slave = xHorde.getSlave(routingKey);
      if (!slave) {
        throw new Error('routingKey without slave');
      }
      return slave.busClient.getToken();
    }

    return this.getToken();
  }

  *loadModule(resp, files, root, info, next) {
    const clearModule = require('clear-module');

    if (!files || !files.length || !root) {
      throw new Error(
        `bad arguments because no JS files are available but xcraftCommands is set`
      );
    }

    const loaded = [];

    for (const file of files) {
      const location = path.join(root, file);
      const handle = require(location);
      if (!handle.hasOwnProperty('xcraftCommands')) {
        clearModule(location);
        xLog.warn(`skip ${location} which is not a valid Xcraft module`);
        continue;
      }

      const name = file.replace(/\.js$/, '');
      /* HACK: accept in the case of wizard module (special behaviour)
       *       But note that the module system has a bad design because
       *       everything is flat. It's just impossible to reload only
       *       specific wizard commands.
       */
      if (this._commander.isModuleRegistered(name) && name !== 'wizard') {
        xLog.warn(
          `skip ${location} because a module with the same name is already registered`
        );
        continue;
      }

      let cmds = {};

      try {
        cmds = handle.xcraftCommands();
      } catch (ex) {
        clearModule(location);
        xLog.err(ex.stack || ex);
        continue;
      }
      const rc = cmds.rc || {};

      /* Save location of module */
      this._modules[name] = {
        name: info.name,
        version: info.version,
        hot: info.hot,
        location,
      };

      /* If at least one command is already registered, this module is
       * fully skipped.
       */
      Object.keys(cmds.handlers)
        .map((cmd) => {
          if (this._commander.isCommandRegistered(cmd)) {
            throw new Error(`command ${cmd} already registered`);
          }
          return cmd;
        })
        .forEach((cmd) => {
          const cmdName = `${name}.${cmd}`;
          this._registerCommand(
            cmdName,
            location,
            info,
            rc[cmd],
            cmds.handlers[cmd]
          );
        });

      loaded.push({name, cmds});
    }

    this.notifyCmdsRegistry();

    if (!resp) {
      return;
    }

    for (const item of loaded) {
      if (item.cmds.handlers._postload) {
        yield resp.command.send(`${item.name}._postload`, null, next);
      }
      if (item.cmds.context && this._contexts[item.name]) {
        yield item.cmds.context.set(
          item.name,
          this._contexts[item.name],
          resp,
          next
        );
      }
    }
  }

  *unloadModule(resp, names, next) {
    if (!names || !names.length) {
      throw new Error(`bad arguments`);
    }

    for (const name of names) {
      if (!this._commander.isModuleRegistered(name)) {
        xLog.warn(`the module ${name} is not loaded`);
        continue;
      }

      if (resp) {
        yield resp.command.send(`${name}._preunload`, null, next);
      }

      const cmds = require(this._modules[name].location).xcraftCommands();
      if (cmds.context) {
        this._contexts[name] = cmds.context.get(name);
        delete this._modules[name];
      }
    }

    // FIXME: overkill because it clears the same modules two times
    for (const name of names) {
      this._commander.unregisterModule(name);
    }

    this.notifyCmdsRegistry();
  }

  *reloadModule(resp, files, root) {
    if (!files || !files.length || !root) {
      throw new Error(`bad arguments`);
    }

    let modName;
    let modVersion;
    let wasHot = false;

    const names = files.map((file) => file.replace(/\.js$/, ''));
    for (const name of names) {
      //FIXME: Package def should be reloaded
      if (!modName) {
        modName = this._modules[name] && this._modules[name].name;
      }
      if (!modVersion) {
        modVersion = this._modules[name] && this._modules[name].version;
      }
      if (!wasHot) {
        wasHot = this._modules[name] && this._modules[name].hot;
      }
    }

    try {
      yield this.unloadModule(resp, names);
    } catch (ex) {
      /* ignore exceptions */
      resp.log.warn(ex.stack || ex);
    }

    yield this.loadModule(resp, files, root, {
      name: modName,
      version: modVersion,
      hot: wasHot,
    });
  }

  runningModuleNames(onlyHot = false) {
    return this._getModules(onlyHot)
      .map((cmd) => cmd.name.replace(/(^[^.]*)\..*/, '$1'))
      .reduce((acc, name) => {
        if (!acc.includes(name)) {
          acc.push(name);
        }
        return acc;
      }, []);
  }

  runningModuleLocations(onlyHot = false) {
    return this._getModules(onlyHot)
      .map((cmd) => cmd.location)
      .reduce((acc, location) => {
        if (!acc.includes(location)) {
          acc.push(location);
        }
        return acc;
      }, []);
  }

  runningModuleDirnames(onlyHot = false) {
    return this._getModules(onlyHot).map((cmd) =>
      path.dirname(cmd.location).reduce((acc, dirname) => {
        if (!acc.includes(dirname)) {
          acc.push(dirname);
        }
        return acc;
      }, [])
    );
  }

  /**
   * Boot buses.
   *
   * @param {Object[]} commandHandlers list of modules.
   * @param {function(err)} next watt's callback.
   */
  *boot(commandHandlers, next) {
    const fs = require('fs');
    const path = require('path');
    const xHost = require('xcraft-core-host');

    const {resourcesPath} = xHost;
    const appArgs = xHost.appArgs();

    xLog.verb('Booting...');

    /* Generate the token */
    const genToken = orcish.generateGreatHall();
    xLog.info('Great Hall created: %s', genToken);
    this._token = genToken;

    /* The server key and certificate are ignored in case of unix socket use */
    if (
      appArgs.tls !== false &&
      !busConfig.noTLS &&
      !busConfig.unixSocketId &&
      !busConfig.keyPath &&
      !busConfig.certPath
    ) {
      const resKeyPath = path.join(resourcesPath, 'server-key.pem');
      const resCertPath = path.join(resourcesPath, 'server-cert.pem');
      if (fs.existsSync(resKeyPath) && fs.existsSync(resCertPath)) {
        busConfig.keyPath = resKeyPath;
        busConfig.certPath = resCertPath;
      }
    }

    const options = {
      timeout: parseInt(busConfig.timeout),
    };
    if (busConfig.keyPath && busConfig.certPath) {
      options.keyPath = busConfig.keyPath;
      options.certPath = busConfig.certPath;
    }

    if (appArgs.tribe >= 1) {
      const tribe = appArgs.tribe - 1;
      busConfig.commanderPort = busConfig.tribes[tribe].commanderPort;
      busConfig.notifierPort = busConfig.tribes[tribe].notifierPort;
    }

    /* Start the bus commander */
    this._commander.start(
      busConfig.commanderHost || busConfig.host,
      parseInt(busConfig.commanderPort),
      busConfig.unixSocketId,
      options,
      genToken,
      next.parallel()
    );

    /* Start the bus notifier */
    this._notifier.start(
      busConfig.notifierHost || busConfig.host,
      parseInt(busConfig.notifierPort),
      busConfig.unixSocketId,
      options,
      next.parallel()
    );

    yield next.sync();

    xEtc.saveRun('xcraft-core-bus', {
      host: busConfig.host,
      commanderPort: this._commander.ports[0] ?? busConfig.commanderPort, //FIXME: multi-ports backends case
      notifierPort: this._notifier.ports[0] ?? busConfig.notifierPort, //FIXME: multi-ports backends case
      noTLS: busConfig.noTLS,
      unixSocketId: busConfig.unixSocketId,
      keyPath: busConfig.keyPath,
      certPath: busConfig.certPath,
      policiesPath: busConfig.policiesPath,
    });

    this.emit('ready', (busClient, callback) =>
      this._loadRegistry(busClient, commandHandlers, (...args) => {
        const busConfig = require('xcraft-core-etc')().load('xcraft-core-bus');
        if (!process.env.XCRAFT_CONFIG) {
          process.env.XCRAFT_CONFIG = '{}';
        }
        const xcraftConfig = JSON.parse(process.env.XCRAFT_CONFIG);
        xcraftConfig['xcraft-core-bus'] = busConfig;
        process.env.XCRAFT_CONFIG = JSON.stringify(xcraftConfig);

        const xConfig = require('xcraft-core-etc')().load('xcraft');
        xLog.dbg(`Xcraft root: ${xConfig.xcraftRoot}`);
        xLog.dbg(`Token: ${this._token}`);
        xLog.dbg(
          `- commander: ${busConfig.commanderHost || busConfig.host}:${
            busConfig.commanderPort
          } [timeout:${busConfig.timeout}]`
        );
        xLog.dbg(
          `- notifier:  ${busConfig.notifierHost || busConfig.host}:${
            busConfig.notifierPort
          } [timeout:${busConfig.timeout}]`
        );

        callback(...args);
      })
    );
  }

  *stop() {
    xLog.verb('Buses stop called, stopping services and sending GameOver...');

    const busClient = require('xcraft-core-busclient').getGlobal();
    const msg = busClient.newMessage();
    this._notifier.send('gameover', msg);

    if (this._commander.isModuleRegistered('probe')) {
      const xProbe = require('xcraft-core-probe');
      xProbe.close();
    }

    if (this._commander.isModuleRegistered('horde')) {
      const xHorde = require('xcraft-core-horde');
      yield xHorde.stop(!!busConfig.forceStop);
    }

    this._commander.stop();
    this._notifier.stop();
    this.emit('stop');
  }
}

module.exports = new Bus();
