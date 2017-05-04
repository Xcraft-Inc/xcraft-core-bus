'use strict';

const moduleName = 'bus/notifier';

const axon = require ('axon');
const xLog = require ('xcraft-core-log') (moduleName, null);

const sock = axon.socket ('pub');

sock.on ('socket error', function (err) {
  xLog.err (err);
});

exports.bus = sock;

exports.start = function (host, port, callback) {
  /* Create domain in order to catch port binding errors. */
  const domain = require ('domain').create ();

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
