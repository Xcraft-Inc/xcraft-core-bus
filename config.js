'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [{
  type: 'input',
  name: 'host',
  message: 'hostname or IP',
  default: '127.0.0.1'
}, {
  type: 'input',
  name: 'commanderPort',
  message: 'commander port',
  validate: function (value) {
    return /^[0-9]{1,}$/.test (value);
  },
  default: '9100'
}, {
  type: 'input',
  name: 'notifierPort',
  message: 'notifier port',
  validate: function (value) {
    return /^[0-9]{1,}$/.test (value);
  },
  default: '9300'
}];
