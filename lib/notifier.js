'use strict';

const moduleName = 'bus/notifier';

const xLog = require('xcraft-core-log')(moduleName, null);
const {Router} = require('xcraft-core-transport');

class Notifier extends Router {
  constructor(id, acceptIncoming) {
    super(id, 'pub', xLog, acceptIncoming);
  }

  start(host, port, unixSocketId, options, callback) {
    super.start({host, port, unixSocketId, ...options}, callback);
  }
}

module.exports = Notifier;
