'use strict';

var moduleName = 'bus/commander';

var axon     = require ('axon');
var activity = require ('xcraft-core-activity');
var xLog     = require ('xcraft-core-log') (moduleName, null);


class Commander {
  constructor () {
    this._sock     = axon.socket ('pull');
    this._token    = 'invalid';
    this._registry = {};

    this._sockSub ();
  }

  _sockSub () {
    this._sock.on ('message', (cmd, msg) => {
      var utils = require ('util');

      xLog.verb ('begin command: %s', cmd);
      xLog.verb ('command received: %s -> msg: %s', cmd, JSON.stringify (msg));

      if (msg.token === this._token || cmd === 'autoconnect') {
        if (cmd === 'autoconnect') {
          msg.orcName = msg.data;
        }

        if (!this._registry.hasOwnProperty (cmd)) {
          var errorMessage  = {};
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

    xLog.verb ('Running command: ', cmd);

    const response = busClient.newResponse (cmd, msg.orcName);

    try {
      this._registry[cmd].handler (msg, response);
    } catch (ex) {
      xLog.err ('unrecovable error with the command "%s": %s', cmd, ex.stack || ex);
      xLog.err ('time to die');
      process.exit (1);
    }
  }

  getCommandsRegistry () {
    return this._registry;
  }

  start (host, port, busToken, callback) {
    /* Save token */
    this._token = busToken;
    /* Create domain in order to catch port binding errors. */
    var domain = require ('domain').create ();

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

  registerCommandHandler (commandKey, commandDesc, commandOptions,
                          isActivity, parallel, handlerFunction) {
    xLog.verb ('Command \'%s\' registered', commandKey);
    var command = {
      handler:  handlerFunction,
      desc:     commandDesc,
      name:     commandKey,
      options:  commandOptions,
      parallel: parallel,
      activity: isActivity
    };
    this._registry[commandKey] = command;
  }

  registerAutoconnectHandler (autoConnectHandler) {
    xLog.verb ('Autoconnect handler registered');
    var command = {
      handler: autoConnectHandler,
      desc:    null,
      name:    'autoconnect'
    };
    this._registry.autoconnect = command;
  }

  registerDisconnectHandler (disconnectHandler) {
    xLog.verb ('Disconnect handler registered');
    var command = {
      handler: disconnectHandler,
      desc:    null,
      name:    'disconnect'
    };
    this._registry.disconnect = command;
  }

  registerShutdownHandler (shutdownHandler) {
    xLog.verb ('Shutdown handler registered');
    var command = {
      handler: shutdownHandler,
      desc:    null,
      name:    'shutdown'
    };
    this._registry.shutdown = command;
  }

  registerErrorHandler (errorHandler) {
    xLog.verb ('Error handler registered');
    var command = {
      handler: errorHandler,
      desc:    'default error handler',
      name:    'error'
    };
    this._registry.error = command;
  }

  registerMotdHandler (motdHandler) {
    xLog.verb ('Motd handler registered');
    var command = {
      handler: motdHandler,
      desc:    null,
      name:    'motd'
    };
    this._registry.motd = command;
  }
}

module.exports = new Commander ();
