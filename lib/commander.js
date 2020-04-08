'use strict';

const moduleName = 'bus/commander';

const watt = require('gigawatts');
const activity = require('xcraft-core-activity');
const xLog = require('xcraft-core-log')(moduleName, null);
const {Router} = require('xcraft-core-transport');
const {isGenerator} = require('xcraft-core-utils').js;

class Commander extends Router {
  constructor(id) {
    super(id, 'pull', xLog);

    this._onMessage = this._onMessage.bind(this);
    this.hook('message', this._onMessage);

    this._token = 'invalid';
    this._registry = {};
    this._modules = {};
  }

  _onMessage(cmd, msg) {
    xLog.verb('begin command: %s', cmd);

    if (!(msg.token === this._token || cmd === 'autoconnect')) {
      xLog.info('invalid token, command discarded');
      return;
    }

    const isCmdAvailable = this._registry.hasOwnProperty(cmd);

    if (cmd === 'autoconnect') {
      msg.orcName = msg.data;
    } else {
      const subCmd = cmd.replace(/[^.]*\.(.*)/, '$1');
      if (/_(preun|post)load/.test(subCmd) && !isCmdAvailable) {
        xLog.verb(`skip ${cmd} because handler not registered`);

        const busClient = require('xcraft-core-busclient').getGlobal();
        busClient.events.send(`${msg.orcName}::${cmd}.${msg.id}.finished`);
        return;
      }
    }

    if (!isCmdAvailable) {
      /* Look for the command in the horde */
      if (this.isModuleRegistered('horde')) {
        const xHorde = require('xcraft-core-horde');
        for (const horde in xHorde.commands) {
          if (xHorde.commands[horde].hasOwnProperty(cmd)) {
            xHorde.busClient.command.send(horde, cmd, msg);
            return;
          }
        }
      }

      const errorMessage = {};
      errorMessage.data = msg;
      errorMessage.cmd = cmd;
      errorMessage.desc = `the command "${cmd}" is not available`;

      cmd = 'error';
      msg = errorMessage;
    }

    /* activity is always true */
    if (
      this._registry[cmd] &&
      this._registry[cmd].activity &&
      msg.isNested === false
    ) {
      xLog.verb(
        'Creating new activity for ',
        JSON.stringify(this._registry[cmd])
      );
      activity.execute(
        cmd,
        msg,
        (cmd, msg) => this._runCommand(cmd, msg),
        this._registry[cmd].parallel
      );
    } else {
      if (!this._registry[cmd]) {
        /* FIXME: it seems that it's possible to arrive here
         * ('error' command not registered). How is possible?
         */
        xLog.err(`the command "${cmd}" is not registered`);
        return;
      }

      /* We can always execute a nested command because the main command is blocked. */
      this._runCommand(cmd, msg);
    }
  }

  _runCommand(cmd, msg) {
    const busClient = require('xcraft-core-busclient').getGlobal();
    const resp = busClient.newResponse(cmd, msg.orcName, {
      router: msg.router,
      originRouter: msg.originRouter,
    });

    try {
      xLog.verb('Running command: %s', cmd);
      this._registry[cmd].handler(msg, resp);
    } catch (ex) {
      xLog.err(
        `error with the command "${cmd}":\n${ex.stack || ex.message || ex}`
      );
    }
  }

  _registerHandler(cmdName, cmdHandler) {
    if (isGenerator(cmdHandler.handler)) {
      xLog.verb(`-> convert '${cmdName}' to a watt generator`);
      cmdHandler.handler = watt(cmdHandler.handler);
    }

    this._registry[cmdName] = cmdHandler;

    const modName = Commander._getModuleFromCmd(cmdName);
    if (!this._modules[modName]) {
      this._modules[modName] = {
        cnt: 0,
        info: cmdHandler.info,
      };
    }
    ++this._modules[modName].cnt;
  }

  getRegistry() {
    return this._registry;
  }

  getFullRegistry() {
    const registry = {};
    const ownRegistry = this.getRegistry();

    if (this.isModuleRegistered('horde')) {
      const xHorde = require('xcraft-core-horde');
      Object.keys(xHorde.public).forEach((horde) => {
        Object.assign(registry, xHorde.public[horde]);
      });
    }

    Object.assign(registry, ownRegistry);
    return registry;
  }

  start(host, port, busToken, callback) {
    this._token = busToken;
    super.start({host, port}, callback);
  }

  /**
   * Check if a command is registered.
   *
   * @param  {string} cmd command's name.
   * @return {Boolean} true if the property exists.
   */
  isCommandRegistered(cmd) {
    return this._registry.hasOwnProperty(cmd);
  }

  /**
   * Extract a module's name from a command's name.
   *
   * @param  {string} cmd command's name.
   * @return {string} module's name.
   */
  static _getModuleFromCmd(cmd) {
    return cmd.replace(/(.*?)\..*/, '$1');
  }

  /**
   * Check if this module is already registered.
   *
   * If it's the case, at least one command is using the same namespace.
   *
   * @param  {string} name module's name.
   * @return {Boolean} true if registered.
   */
  isModuleRegistered(name) {
    return this._modules.hasOwnProperty(name) && this._modules[name].cnt > 0;
  }

  /**
   * Retrieve some useful informations about a specific module.
   *
   * @param {*} name - module's name.
   * @returns {Object} the module's info.
   */
  getModuleInfo(name) {
    return (
      (this._modules.hasOwnProperty(name) && this._modules[name].info) || {}
    );
  }

  /**
   * Unregister a module from the registry.
   *
   * The module is really cleared from the require.cache. Because the registry
   * contents only commands, the module's name is extracted from the command
   * name.
   *
   * @param  {string} name module's name.
   */
  unregisterModule(name) {
    const clearRequire = require('clear-require');
    const xFs = require('xcraft-core-fs');
    const path = require('path');

    Object.keys(this._registry)
      .filter((cmd) => Commander._getModuleFromCmd(cmd) === name)
      .map((cmd) => this._registry[cmd])
      .reduce((acc, command) => {
        delete this._registry[command.name];

        const modName = Commander._getModuleFromCmd(command.name);
        --this._modules[modName].cnt;
        if (this._modules[modName].cnt === 0) {
          delete this._modules[modName];
        }

        const modPath = path.dirname(command.location);
        if (!acc.includes(modPath)) {
          acc.push(modPath);
        }
        return acc;
      }, [])
      .forEach((location) => {
        xFs
          .lsall(location, true)
          .filter((file) => /^[^.].*\.js$/.test(file))
          .forEach((file) => {
            clearRequire(file);
          });
      });
  }

  registerCommandHandler(name, location, info, rc, handler) {
    xLog.verb("Command '%s' registered", name);
    const command = Object.assign(
      {
        handler,
        name,
        location,
        info,
      },
      rc
    );
    this._registerHandler(name, command);
  }

  _registerBuiltinHandler(name, handler, desc) {
    xLog.verb(`${name} handler registered`);
    const command = {
      handler,
      desc /* null for private commands */,
      name,
    };
    this._registerHandler(name, command);
  }

  registerErrorHandler(handler) {
    this._registerBuiltinHandler('error', handler);
  }

  registerAutoconnectHandler(handler) {
    this._registerBuiltinHandler('autoconnect', handler);
  }

  registerDisconnectHandler(handler) {
    this._registerBuiltinHandler('disconnect', handler);
  }

  registerShutdownHandler(handler) {
    this._registerBuiltinHandler(
      'shutdown',
      handler,
      'disconnect all clients and shutdown the Xcraft server'
    );
  }

  registerMotdHandler(handler) {
    this._registerBuiltinHandler('motd', handler);
  }

  registerBroadcastHandler(handler) {
    this._registerBuiltinHandler('broadcast', handler);
  }
}

module.exports = Commander;
