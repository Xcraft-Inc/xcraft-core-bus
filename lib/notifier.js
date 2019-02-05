'use strict';

const moduleName = 'bus/notifier';

const xLog = require('xcraft-core-log')(moduleName, null);
const {Router} = require('xcraft-core-transport');

class Notifier extends Router {
  constructor(id) {
    super(id, 'pub', xLog);
  }

  start(host, port, callback) {
    super.start({host, port}, callback);
  }
}

module.exports = Notifier;
