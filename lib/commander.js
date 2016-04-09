'use strict';

var moduleName = 'bus/commander';

var axon     = require ('axon');
var activity = require ('xcraft-core-activity');
var xLog     = require ('xcraft-core-log') (moduleName, null);

var sock  = axon.socket ('pull');
var token = 'invalid';
var commandsRegistry = {};


class Commander {
  constructor () {
    this._sockSub ();
  }

  _sockSub () {
    sock.on ('message', (cmd, msg) => {
      var utils = require ('util');

      xLog.verb ('begin command: %s', cmd);
      xLog.verb ('command received: %s -> msg: %s', cmd, JSON.stringify (msg));

      if (msg.token === token || cmd === 'autoconnect') {
        if (cmd === 'autoconnect') {
          msg.orcName = msg.data;
        }

        if (!commandsRegistry.hasOwnProperty (cmd)) {
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
      if (commandsRegistry[cmd].activity && msg.isNested === false) {
        xLog.verb ('Creating new activity for ', JSON.stringify (commandsRegistry[cmd]));
        activity.execute (cmd, msg, this._runCommand, commandsRegistry[cmd].parallel);
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
      commandsRegistry[cmd].handler (msg, response);
    } catch (ex) {
      xLog.err ('unrecovable error with the command "%s": %s', cmd, ex.stack || ex);
      xLog.err ('time to die');
      process.exit (1);
    }
  }

  get sock () {
    return sock;
  }

  getCommandsRegistry () {
    return commandsRegistry;
  }

  start (host, port, busToken, callback) {
    /* Save token */
    token = busToken;
    /* Create domain in order to catch port binding errors. */
    var domain = require ('domain').create ();

    domain.on ('error', function (err) {
      xLog.err ('bus running on %s:%d, error: %s', host, port, err.stack);
    });

    /* Try binding in domain. */
    domain.run (function () {
      sock.bind (parseInt (port), host, callback);
      xLog.verb ('Bus started on %s:%d', host, port);
    });
  }

  stop () {
    sock.close ();
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
    commandsRegistry[commandKey] = command;
  }

  registerAutoconnectHandler (autoConnectHandler) {
    xLog.verb ('Autoconnect handler registered');
    var command = {
      handler: autoConnectHandler,
      desc:    null,
      name:    'autoconnect'
    };
    commandsRegistry.autoconnect = command;
  }

  registerDisconnectHandler (disconnectHandler) {
    xLog.verb ('Disconnect handler registered');
    var command = {
      handler: disconnectHandler,
      desc:    null,
      name:    'disconnect'
    };
    commandsRegistry.disconnect = command;
  }

  registerShutdownHandler (shutdownHandler) {
    xLog.verb ('Shutdown handler registered');
    var command = {
      handler: shutdownHandler,
      desc:    null,
      name:    'shutdown'
    };
    commandsRegistry.shutdown = command;
  }

  registerErrorHandler (errorHandler) {
    xLog.verb ('Error handler registered');
    var command = {
      handler: errorHandler,
      desc:    'default error handler',
      name:    'error'
    };
    commandsRegistry.error = command;
  }

  registerMotdHandler (motdHandler) {
    xLog.verb ('Motd handler registered');
    var command = {
      handler: motdHandler,
      desc:    null,
      name:    'motd'
    };
    commandsRegistry.motd = command;
  }
}

module.exports = new Commander ();
