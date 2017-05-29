'use strict';

const Axon = require ('./backend/axon.js');

class Router {
  constructor (mode, log) {
    this._axon = new Axon (mode, log);
    this._log = log;
    this._options = {};
  }

  get options () {
    return this._options;
  }

  on (...args) {
    this._axon.on (...args);
  }

  send (...args) {
    this._axon.send (...args);
  }

  start (options, callback) {
    this._options = options;
    this._axon.start (options.host, options.port, callback);
  }

  stop () {
    this._axon.stop ();
  }
}

module.exports = Router;
