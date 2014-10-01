'use strict';

var moduleName = 'notific-bus';

var zogLog    = require ('xcraft-core-log') (moduleName);
var axon      = require ('axon');


var sock = axon.socket ('pub');
var heartbeatPulsor = null;

sock.on ('socket error', function (err) {
  zogLog.err (err);
});

exports.bus = sock;

exports.start = function (host, port, callback) {
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

  heartbeatPulsor = setInterval (function () {
    sock.send ('heartbeat');
  }, 1000);
};

exports.stop = function () {
  clearInterval (heartbeatPulsor);
  sock.close ();
};
