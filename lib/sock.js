'use strict';

const moduleName = 'bus/sock';

const axon = require ('axon');

class Sock {
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

  get sock () {
    return this._sock;
  }

  get host () {
    return this._host;
  }

  get port () {
    return this._port;
  }

  start (host, port, callback) {
    this._host = host;
    this._port = parseInt (port);

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

module.exports = Sock;
