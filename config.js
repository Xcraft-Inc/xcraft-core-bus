'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'input',
    name: 'host',
    message: 'hostname or IP',
    default: '127.0.0.1',
  },
  {
    type: 'input',
    name: 'commanderHost',
    message: 'hostname or IP',
    default: '',
  },
  {
    type: 'input',
    name: 'commanderPort',
    message: 'commander port',
    validate: function (value) {
      return /^[0-9]{1,}$/.test(value);
    },
    default: '35400',
  },
  {
    type: 'input',
    name: 'notifierHost',
    message: 'hostname or IP',
    default: '',
  },
  {
    type: 'input',
    name: 'notifierPort',
    message: 'notifier port',
    validate: function (value) {
      return /^[0-9]{1,}$/.test(value);
    },
    default: '35800',
  },
  {
    type: 'input',
    name: 'timeout',
    message: 'TCP timeout',
    default: 0,
  },
  {
    type: 'input',
    name: 'serverKeepAlive',
    message: 'keep-alive for onconnect (server) connections on the server',
    default: 15000,
  },
  {
    type: 'input',
    name: 'clientKeepAlive',
    message: 'keep-alive for connect (client) connections to the server',
    default: 6000,
  },
  {
    type: 'confirm',
    name: 'noTLS',
    message: 'disable TLS',
    default: false,
  },
  {
    type: 'input',
    name: 'unixSocketId',
    message: 'used on *nix for axon bus sockets',
    default: '',
  },
  {
    type: 'confirm',
    name: 'acceptIncoming',
    message: 'enable new connections immediately',
    default: true,
  },
  {
    type: 'confirm',
    name: 'shutdownRemotes',
    message: 'shutdown remote hordes',
    default: false,
  },
  {
    type: 'input',
    name: 'keyPath',
    message: 'path on a server key file (pem)',
    default: '',
  },
  {
    type: 'input',
    name: 'certPath',
    message: 'path on a server certificate file (pem)',
    default: '',
  },
  {
    type: 'input',
    name: 'policiesPath',
    message: 'security policies file (json)',
    default: '',
  },
  {
    type: 'checkbox',
    name: 'tribes',
    message: 'tribes to deploy multiple nodes',
    choices: [],
    default: [],
  },
  {
    type: 'confirm',
    name: 'horde.passive',
    message:
      'commands are never forwarded to the hordes (events are received as usual)',
    default: false,
  },
];
