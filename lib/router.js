'use strict';

const watt = require ('watt');
const path = require ('path');

class Router {
  constructor (mode, log) {
    const xFs = require ('xcraft-core-fs');

    this._mode = mode;
    this._log = log;
    this._options = {};
    this._clients = new Map ();

    const backends = path.join (__dirname, 'backends');

    this._backends = xFs
      .ls (backends, /\.js$/)
      .map (mod => new (require (path.join (backends, mod))) (this._mode, log));

    watt.wrapAll (this, '_start');
  }

  get options () {
    return this._options;
  }

  on (...args) {
    this._backends.forEach (backend => backend.on (...args));
  }

  send (...args) {
    this._backends.forEach (backend => backend.send (...args));
  }

  start (options, callback) {
    this._start (options, callback);
  }

  *_start (options, next) {
    this._options = options;
    this._backends.forEach (backend =>
      backend.start (options, next.parallel ())
    );
    yield next.sync ();
  }

  stop () {
    this._axon.stop ();
  }
}

module.exports = Router;
