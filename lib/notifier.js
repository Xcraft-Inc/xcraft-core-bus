'use strict';

const moduleName = 'bus/notifier';

const xLog = require ('xcraft-core-log') (moduleName, null);
const Sock = require ('./sock.js');

class Notifier extends Sock {
  constructor () {
    super ('pub', xLog);
  }

  send (...args) {
    this.sock.send.apply (this.sock, args);
  }
}

module.exports = new Notifier ();
