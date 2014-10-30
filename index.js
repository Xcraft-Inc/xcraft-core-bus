/* Buses Booting */
'use strict';

var moduleName   = 'bus-boot';

var async        = require ('async');
var zogLog       = require ('xcraft-core-log') (moduleName);
var crypto       = require ('crypto');
var busNotifier  = require ('./busNotifier.js');
var busCommander = require ('./busCommander.js');
var busConfig    = require ('xcraft-core-etc').load ('xcraft-core-bus');
var EventEmitter = require ('events').EventEmitter;

var bootReady = false;
var token     = '';
var emitter   = new EventEmitter ();
var notifier  = {};
var commander = {};

var generateBusToken = function (callbackDone) {
  var createKey = function (key) {
    var shasum = crypto.createHash ('sha1');
    shasum.update (key);
    return shasum.digest ('hex');
  };

  var buf = null;

  try {
    buf = crypto.randomBytes (256);
    callbackDone (createKey (buf));
  } catch (ex) {
    /* Handle error.
     * Most likely, entropy sources are drained.
     */
    zogLog.err (ex);
    crypto.pseudoRandomBytes (256, function (ex, buf) {
      if (ex) {
        throw ex;
      }

      callbackDone (createKey (buf));
    });
  }
};

/**
 * Browse /scripts for zog modules, and register exported xcraftCommands.
 */
var loadCommandsRegistry = function (modulePath, filterRegex) {
  var path  = require ('path');
  var zogFs = require ('xcraft-core-fs');

  var zogModules = {};
  var zogModulesFiles = zogFs.ls (modulePath, filterRegex);

  zogModulesFiles.forEach (function (fileName) {
    zogModules[fileName] = require (path.join (modulePath, fileName));

    if (zogModules[fileName].hasOwnProperty ('xcraftCommands')) {
      zogModules[fileName].xcraftCommands ().forEach (function (cmd) {
        var commandName = fileName.replace (/\.js$/, '') + '.' + cmd.name;
        busCommander.registerCommandHandler (commandName, cmd.desc, cmd.params, cmd.options, cmd.handler);
      });
    }
  });
};

exports.getEmitter = emitter;

exports.getCommander = function () {
  return commander;
};

exports.getNotifier = function () {
  return notifier;
};

exports.getToken = function () {
  return token;
};

exports.newMessage = function () {
  return require('./busMessage.js')();
};

/**
 * Boot
 * @param {Object[]} commandHandlers - Array of objects with properties
 *                                     [{path:, filePattern:}]
 */
exports.boot = function (commandHandlers) {
  zogLog.verb ('Booting...');

  /* init all boot chain */
  async.auto ({
    taskToken: function (callback) {
      generateBusToken (function (genToken) {
        zogLog.verb ('Bus token created: %s', genToken);
        token = genToken;

        /* load some command handler from modules/scripts locations */
        Object.keys (commandHandlers).forEach (function (index) {
          loadCommandsRegistry (commandHandlers[index].path,
                                commandHandlers[index].pattern);
        });


        callback (null, genToken);
      });
    },

    taskCommander: ['taskToken', function (callback, results) {
      busCommander.start (busConfig.host,
                          parseInt (busConfig.commanderPort),
                          results.taskToken,
                          callback ());
    }],

    taskNotifier: function (callback) {
      busNotifier.start (busConfig.host,
                         parseInt (busConfig.notifierPort),
                         callback ());
    },

    taskReady: ['taskCommander', 'taskNotifier', function (callback) {
      notifier = busNotifier.bus;
      commander = busCommander;
      bootReady = true;
      emitter.emit ('ready');
      callback ();
    }]
  }, function (err) {
    if (err) {
      zogLog.err (err);
    }
  });
};

exports.stop = function () {
  zogLog.verb ('Buses stop called');
  emitter.emit ('stop');
  busNotifier.stop ();
  busCommander.stop ();
};

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
exports.xcraftConfig = [{
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
  default: '9200'
}];
