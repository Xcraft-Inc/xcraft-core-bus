'use strict';

var moduleName = 'command-bus';

var zogLog     = require ('xcraft-core-log') (moduleName);
var axon       = require ('axon');

var sock             = axon.socket ('pull');
var token            = 'invalid';
var commandsRegistry = {};


exports.bus = sock;

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

exports.registerCommandHandler = function (commandKey, handlerFunction) {
  zogLog.verb ('Command \'%s\' registered', commandKey);

  commandsRegistry[commandKey] = handlerFunction;
};

exports.registerErrorHandler = function (errorHandler) {
  zogLog.verb ('Error handler registered');

  commandsRegistry.error = errorHandler;
};

sock.on ('message', function (cmd, msg) {
  var utils = require ('util');

  zogLog.verb ('begin command: %s', cmd);
  zogLog.verb ('command received: %s -> msg: %s', cmd, JSON.stringify (msg));

  if (msg.token === token) {
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

  commandsRegistry[cmd] (msg);
});
