'use strict';

const moduleName = 'bus/notifier';

const axon = require ('axon');
const xLog = require ('xcraft-core-log') (moduleName, null);

class Notifier {
  constructor () {
    this._sock = axon.socket ('pub');

    this._sock.on ('socket error', xLog.err);
  }

  start (host, port, callback) {
    /* Create domain in order to catch port binding errors. */
    const domain = require ('domain').create ();

    domain.on ('error', err => {
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

  get bus () {
    return this._sock;
  }
}

module.exports = new Notifier ();
