'use strict';

const moduleName = 'bus/axon';

const axon = require ('axon');

class Axon {
  constructor (mode, log) {
    this._host = '';
    this._port = 0;
    this._log = log;
    this._sock = axon.socket (mode).on ('socket error', err => {
      const xLog = require ('xcraft-core-log') (moduleName, null);
      xLog.err (err);
    });
  }

  _bind (callback) {
    this._sock.bind (this._port, this._host, err => {
      if (!err) {
        this._log.verb ('bus started on %s:%d', this._host, this._port);
      }
      callback (err);
    });
  }

  on (...args) {
    this._sock.on (...args);
  }

  send (...args) {
    this._sock.send (...args);
  }

  start (options, callback) {
    this._host = options.host;
    this._port = parseInt (options.port);

    /* Create domain in order to catch port binding errors. */
    const domain = require ('domain').create ();

    domain.on ('error', err => {
      this._log.warn (
        'bus binding on %s:%d, error: %s',
        this._host,
        this._port,
        err.message
      );

      if (/^(EADDRINUSE|EACCES)$/.test (err.code)) {
        this._port++;
        this._log.warn (`address in use, retrying on port ${this._port}`);

        setTimeout (() => {
          this._bind (callback);
        }, 0);
        return;
      }

      this._log.err ('this exception is fatal, we cannot continue...');
      process.exit (1);
    });

    /* Try binding in domain. */
    domain.run (() => {
      this._bind (callback);
    });
  }

  stop () {
    this._sock.close ();
    this._log.verb (`bus ${this._host}:${this._port} closed`);
  }
}

module.exports = Axon;