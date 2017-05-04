'use strict';

const moduleName = 'bus/notifier';

const xLog = require ('xcraft-core-log') (moduleName, null);
const Sock = require ('./sock.js');

class Notifier extends Sock {
  constructor () {
    super ('pub', xLog);
  }

  get bus () {
    return this._sock;
  }
}

module.exports = new Notifier ();
