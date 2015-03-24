'use strict';

var moduleName = 'command-bus';

var axon        = require ('axon');
var activity    = require ('xcraft-core-activity');
var xLog        = require ('xcraft-core-log') (moduleName);

var sock             = axon.socket ('pull');
var token            = 'invalid';
var state            = {
  event: null,
  which: 'greathall'
};
var commandsRegistry = {};


exports.bus = sock;

exports.getCommandsRegistry = function () {
  return commandsRegistry;
};

exports.start = function (host, port, busToken, callback) {
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
};

exports.stop = function () {
  sock.close ();
};

exports.getCurrentState = function () {
  return state;
};

exports.resetCurrentState = function () {
  state.event = null;
  state.which = 'greathall';
};

exports.registerCommandHandler = function ( commandKey,
                                            commandDesc,
                                            commandOptions,
                                            isActivity,
                                            handlerFunction) {
  xLog.verb ('Command \'%s\' registered', commandKey);
  var command = {
    handler:  handlerFunction,
    desc:     commandDesc,
    name:     commandKey,
    options:  commandOptions,
    activity: isActivity
  };
  commandsRegistry[commandKey] = command;
};

exports.registerAutoconnectHandler = function (autoConnectHandler) {
  xLog.verb ('Autoconnect handler registered');
  var command = {
    handler: autoConnectHandler,
    desc:    null,
    name:    'autoconnect'
  };
  commandsRegistry.autoconnect = command;
};

exports.registerShutdownHandler = function (shutdownHandler) {
  xLog.verb ('Shutdown handler registered');
  var command = {
    handler: shutdownHandler,
    desc:    null,
    name:    'shutdown'
  };
  commandsRegistry.shutdown = command;
};

exports.registerErrorHandler = function (errorHandler) {
  xLog.verb ('Error handler registered');
  var command = {
    handler: errorHandler,
    desc:    'default error handler',
    name:    'error'
  };
  commandsRegistry.error = command;
};

sock.on ('message', function (cmd, msg) {
  var utils = require ('util');

  xLog.verb ('begin command: %s', cmd);
  xLog.verb ('command received: %s -> msg: %s', cmd, JSON.stringify (msg));

  if (msg.token === token || cmd === 'autoconnect') {
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

  if (commandsRegistry[cmd].activity === true) {
    activity.create (cmd, msg);
  }

  if (!state.event) {
    state.event = cmd + '.finished';
    state.which = msg.orcName || 'greathall';
  }

  try {
    commandsRegistry[cmd].handler (msg);
  } catch (ex) {
    xLog.err ('unrecovable error with the command "%s": %s', cmd, ex.stack);
    xLog.err ('time to die');
    process.exit (1);
  }
});
