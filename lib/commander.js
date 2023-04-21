'use strict';

const moduleName = 'bus/commander';

const watt = require('gigawatts');
const xEtc = require('xcraft-core-etc')();
const activity = require('xcraft-core-activity');
const xLog = require('xcraft-core-log')(moduleName, null);
const {Router} = require('xcraft-core-transport');
const {isGenerator} = require('xcraft-core-utils').js;

class Commander extends Router {
  constructor(id, acceptIncoming) {
    super(id, 'pull', xLog, acceptIncoming);

    this._onMessage = this._onMessage.bind(this);
    this.hook('message', this._onMessage);

    this._token = 'invalid';
    this._registry = {};
    this._modules = {};
  }

  get busClient() {
    if (this._busClient) {
      return this._busClient;
    }
    this._busClient = require('xcraft-core-busclient').getGlobal();
    return this._busClient;
  }

  static #unavailableCmdError(cmd) {
    const err = new Error(`the command "${cmd}" is not available`);
    err.code = 'CMD_NOT_AVAILABLE';
  }

  getRoutingKeyFromId(cmd, id, isRPC = false) {
    if (!cmd) {
      throw new Error('The `cmd` is mandatory');
    }

    let isCmdAvailable = !isRPC && !!this._registry[cmd];

    let xHorde;
    if (this.isModuleRegistered('horde')) {
      xHorde = require('xcraft-core-horde');
    }

    let dstTribe = 0;
    if (isCmdAvailable) {
      const coreGoblin = this._registry[cmd].registrar === 'xcraft-core-goblin';

      if (
        coreGoblin &&
        xHorde &&
        xHorde.isTribeDispatcher &&
        !cmd.startsWith('goblin.') &&
        !cmd.startsWith('goblin-cache.') &&
        !cmd.startsWith('warehouse.')
      ) {
        const hasId = !!id;
        const isDistributable = !!(hasId && id.indexOf('@') !== -1);

        const xHost = require('xcraft-core-host');
        const {tribe} = xHost.appArgs();

        if (isDistributable) {
          dstTribe = xHost.getTribeFromId(id);
          if (tribe !== dstTribe) {
            isCmdAvailable = false;
          }
        } else if (tribe !== 0) {
          isCmdAvailable = false;
        }
      }
    }

    if (isCmdAvailable) {
      return null;
    }

    /* Look for the command in the horde */
    if (xHorde) {
      const slaves = xHorde.commands;
      let _horde;
      for (const horde in slaves) {
        const _tribe = xHorde.getTribe(horde);

        if (dstTribe > 0 && _tribe !== dstTribe) {
          continue;
        }

        const _cmd = slaves[horde][cmd];
        if (_cmd) {
          _horde = horde;
          /* Prefer the shorter path */
          if (!_cmd.noForwarding || !_cmd.noForwarding[horde]) {
            break;
          }
        }
      }
      if (_horde) {
        return xHorde.getSlave(_horde).routingKey;
      }
    }

    throw Commander.#unavailableCmdError(cmd);
  }

  _onMessage(cmd, msg) {
    if (!(msg.token === this._token || cmd === 'autoconnect')) {
      xLog.info('invalid token, command discarded');
      return;
    }

    let isCmdAvailable = !!this._registry[cmd];

    if (cmd === 'autoconnect') {
      msg.orcName = msg.data.autoConnectToken;
    } else if (
      !isCmdAvailable &&
      (cmd.endsWith('._postload') || cmd.endsWith('._preunload'))
    ) {
      xLog.verb(`skip ${cmd} because handler not registered`);
      this.busClient.events.send(`${msg.orcName}::${cmd}.${msg.id}.finished`);
      return;
    }

    try {
      /* _xcraftRPC is for the case where we want to send the command to the horde */
      const isRPC = !!msg?.data?._xcraftRPC;
      const routingKey = this.getRoutingKeyFromId(cmd, msg?.data?.id, isRPC);
      if (routingKey) {
        const xHorde = require('xcraft-core-horde');
        const busConfig = xEtc.load('xcraft-core-bus');

        /* Disable commands forwarding in passive mode, without xcraftRPC */
        const isForwarded = !busConfig?.horde?.passive || isRPC;
        if (isForwarded) {
          if (msg.orcName === 'greathall') {
            throw new Error(
              'forbidden use of busClient with a command sent via xHorde with the "greathall" orcName'
            );
          }

          xHorde.busClient.command.send(routingKey, cmd, msg);
          return;
        }

        if (!isCmdAvailable) {
          throw Commander.#unavailableCmdError(cmd);
        }
      }
    } catch (ex) {
      if (ex.code !== 'CMD_NOT_AVAILABLE') {
        throw ex;
      }

      const errorMessage = {};
      errorMessage.data = msg;
      errorMessage.cmd = cmd;
      errorMessage.desc = ex.stack || ex.message || ex;

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
        (cmd, msg) => this._runCommand(cmd, msg, true),
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
      this._runCommand(cmd, msg, false);
    }
  }

  _runCommand(cmd, msg, isActivity) {
    const routing = {
      router: msg.router,
      originRouter: msg.originRouter,
      activity: isActivity,
    };
    if (msg.forwarding) {
      routing.forwarding = {...msg.forwarding};
      routing.forwarding.route = msg.route;
    }

    const resp = this.busClient.newResponse(
      cmd,
      msg.orcName,
      routing,
      msg.context
    );

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
      const {appId, appArgs} = require('xcraft-core-host');
      const {tribe} = appArgs();
      const routingKey = tribe ? `${appId}-${tribe}` : appId;
      const xHorde = require('xcraft-core-horde');
      Object.keys(xHorde.commands).forEach((horde) => {
        const noForwarding = xHorde.isNoForwarding(horde);
        if (noForwarding) {
          Object.values(xHorde.commands[horde]).forEach((cmd) => {
            if (!cmd.noForwarding) {
              cmd.noForwarding = {};
            }
            cmd.noForwarding = {...cmd.noForwarding, [routingKey]: true};
          });
        }
        Object.assign(registry, xHorde.commands[horde]);
      });
    }

    Object.assign(registry, ownRegistry);
    return registry;
  }

  start(host, port, unixSocketId, options, busToken, callback) {
    this._token = busToken;
    super.start({host, port, unixSocketId, ...options}, callback);
  }

  /**
   * Check if a command is registered.
   *
   * @param   {string} cmd command's name.
   * @returns {boolean} true if the property exists.
   */
  isCommandRegistered(cmd) {
    return this._registry.hasOwnProperty(cmd);
  }

  /**
   * Extract a module's name from a command's name.
   *
   * @param   {string} cmd command's name.
   * @returns {string} module's name.
   */
  static _getModuleFromCmd(cmd) {
    return cmd.replace(/(.*?)\..*/, '$1');
  }

  /**
   * Check if this module is already registered.
   *
   * If it's the case, at least one command is using the same namespace.
   *
   * @param   {string} name module's name.
   * @returns {boolean} true if registered.
   */
  isModuleRegistered(name) {
    return this._modules.hasOwnProperty(name) && this._modules[name].cnt > 0;
  }

  /**
   * Retrieve some useful informations about a specific module.
   *
   * @param {*} name - module's name.
   * @returns {object} the module's info.
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
    const clearModule = require('clear-module');
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
            clearModule(file);
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
