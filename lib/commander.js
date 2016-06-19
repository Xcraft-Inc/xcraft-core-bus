'use strict';

const moduleName = 'bus/commander';

const axon     = require ('axon');
const watt     = require ('watt');
const activity = require ('xcraft-core-activity');
const xLog     = require ('xcraft-core-log') (moduleName, null);


class Commander {
  constructor () {
    this._sock     = axon.socket ('pull');
    this._token    = 'invalid';
    this._registry = {};

    this._sockSub ();
  }

  _sockSub () {
    this._sock.on ('message', (cmd, msg) => {
      const utils = require ('util');

      xLog.verb ('begin command: %s', cmd);
      xLog.verb ('command received: %s -> msg: %s', cmd, JSON.stringify (msg));

      if (msg.token === this._token || cmd === 'autoconnect') {
        if (cmd === 'autoconnect') {
          msg.orcName = msg.data;
        }

        if (!this._registry.hasOwnProperty (cmd)) {
          const errorMessage  = {};
          errorMessage.data = msg;
          errorMessage.cmd  = cmd;
          errorMessage.desc = utils.format ('the command "%s" is not available', cmd);

          cmd = 'error';
          msg = errorMessage;
        }
      } else {
        xLog.verb ('invalid token, command discarded');
        return;
      }

      /* activity is always true */
      if (this._registry[cmd].activity && msg.isNested === false) {
        xLog.verb ('Creating new activity for ', JSON.stringify (this._registry[cmd]));
        activity.execute (cmd, msg, (cmd, msg) => this._runCommand (cmd, msg), this._registry[cmd].parallel);
      } else {
        /* We can always execute a nested command because the main command is blocked. */
        this._runCommand (cmd, msg);
      }
    });
  }

  _runCommand (cmd, msg) {
    const busClient = require ('xcraft-core-busclient').getGlobal ();
    const response = busClient.newResponse (cmd, msg.orcName);

    try {
      xLog.verb ('Running command: ', cmd);
      this._registry[cmd].handler (msg, response);
    } catch (ex) {
      xLog.err (`error with the command "${cmd}": ${ex.stack || ex}`);
    }
  }

  _isGenerator (handler) {
    return handler && handler.constructor && handler.constructor.name === 'GeneratorFunction';
  }

  _registerHandler (cmdName, cmdHandler) {
    if (this._isGenerator (cmdHandler.handler)) {
      xLog.verb (`-> convert '${cmdName}' to a watt generator`);
      cmdHandler.handler = watt (cmdHandler.handler);
    }

    this._registry[cmdName] = cmdHandler;
  }

  getRegistry () {
    return this._registry;
  }

  start (host, port, busToken, callback) {
    /* Save token */
    this._token = busToken;
    /* Create domain in order to catch port binding errors. */
    const domain = require ('domain').create ();

    domain.on ('error', (err) => {
      xLog.err ('bus running on %s:%d, error: %s', host, port, err.stack);
    });

    /* Try binding in domain. */
    domain.run (() => {
      this._sock.bind (parseInt (port), host, callback);
      xLog.verb ('Bus started on %s:%d', host, port);
    });
  }

  stop () {
    this._sock.close ();
  }

  registerCommandHandler (name, desc, options, isActivity, parallel, handler) {
    xLog.verb ('Command \'%s\' registered', name);
    const command = {
      handler:  handler,
      desc:     desc,
      name:     name,
      options:  options,
      parallel: parallel,
      activity: isActivity
    };
    this._registerHandler (name, command);
  }

  registerAutoconnectHandler (handler) {
    xLog.verb ('Autoconnect handler registered');
    const command = {
      handler: handler,
      desc:    null,
      name:    'autoconnect'
    };
    this._registerHandler ('autoconnect', command);
  }

  registerDisconnectHandler (handler) {
    xLog.verb ('Disconnect handler registered');
    const command = {
      handler: handler,
      desc:    null,
      name:    'disconnect'
    };
    this._registerHandler ('disconnect', command);
  }

  registerShutdownHandler (handler) {
    xLog.verb ('Shutdown handler registered');
    const command = {
      handler: handler,
      desc:    null,
      name:    'shutdown'
    };
    this._registerHandler ('shutdown', command);
  }

  registerErrorHandler (handler) {
    xLog.verb ('Error handler registered');
    const command = {
      handler: handler,
      desc:    'default error handler',
      name:    'error'
    };
    this._registerHandler ('error', command);
  }

  registerMotdHandler (handler) {
    xLog.verb ('Motd handler registered');
    const command = {
      handler: handler,
      desc:    null,
      name:    'motd'
    };
    this._registerHandler ('motd', command);
  }
}

module.exports = new Commander ();
