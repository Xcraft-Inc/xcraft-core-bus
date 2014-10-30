'use strict';

var moduleName = 'command-bus';

var zogLog     = require ('xcraft-core-log') (moduleName);
var axon       = require ('axon');

var sock             = axon.socket ('pull');
var token            = 'invalid';
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
    zogLog.err ('bus running on %s:%d, error: %s', host, port, err.message);
  });

  /* Try binding in domain. */
  domain.run (function () {
    sock.bind (parseInt (port), host, callback);
    zogLog.verb ('Bus started on %s:%d', host, port);
  });
};

exports.stop = function () {
  sock.close ();
};

exports.registerCommandHandler = function (commandKey, commandDesc, commandParams, commandOptions, handlerFunction) {
  zogLog.verb ('Command \'%s\' registered', commandKey);
  var command = {
    handler : handlerFunction,
    desc    : commandDesc,
    params  : commandParams,
    name    : commandKey,
    options : commandOptions
  };
  commandsRegistry[commandKey] = command;
};


exports.registerAutoconnectHandler = function (autoConnectHandler) {
  zogLog.verb ('Autoconnect handler registered');
  var command = {
    handler: autoConnectHandler,
    desc   : 'autoconnect',
    name   : 'autoconnect'
  };
  commandsRegistry.autoconnect = command;
};

exports.registerShutdownHandler = function (shutdownHandler) {
  zogLog.verb ('Shutdown handler registered');
  var command = {
    handler: shutdownHandler,
    desc   : 'shutdown',
    name   : 'shutdown'
  };
  commandsRegistry.shutdown = command;
};

exports.registerErrorHandler = function (errorHandler) {
  zogLog.verb ('Error handler registered');
  var command = {
    handler: errorHandler,
    desc   : 'default error handler',
    name   : 'error'
  };
  commandsRegistry.error = command;
};

sock.on ('message', function (cmd, msg) {
  var utils = require ('util');

  zogLog.verb ('begin command: %s', cmd);
  zogLog.verb ('command received: %s -> msg: %s', cmd, JSON.stringify (msg));

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
    zogLog.verb ('invalid token, command discarded');
    return;
  }

  commandsRegistry[cmd].handler (msg);
});
