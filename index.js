/* Buses Booting */
'use strict';

var moduleName   = 'bus-boot';

var async  = require ('async');
var crypto = require ('crypto');

var busNotifier  = require ('./lib/notifier.js');
var busCommander = require ('./lib/commander.js');

var xLog      = require ('xcraft-core-log') (moduleName);
var busConfig = require ('xcraft-core-etc').load ('xcraft-core-bus');

var EventEmitter = require ('events').EventEmitter;

var bootReady = false;
var token     = '';
var emitter   = new EventEmitter ();
var notifier  = {};
var commander = {};

var generateBusToken = function (callback) {
  var createKey = function (key) {
    var shasum = crypto.createHash ('sha1');
    shasum.update (key);
    return shasum.digest ('hex');
  };

  var buf = null;

  try {
    buf = crypto.randomBytes (256);
    callback (null, createKey (buf));
  } catch (ex) {
    /* Handle error.
     * Most likely, entropy sources are drained.
     */
    xLog.err (ex);
    crypto.pseudoRandomBytes (256, function (ex, buf) {
      if (ex) {
        throw ex;
      }

      callback (null, createKey (buf));
    });
  }
};

/**
 * Browse /scripts for zog modules, and register exported xcraftCommands.
 */
var loadCommandsRegistry = function (modulePath, filterRegex) {
  var path = require ('path');
  var xFs  = require ('xcraft-core-fs');

  var modules = {};
  var modulesFiles = xFs.ls (modulePath, filterRegex);

  modulesFiles.forEach (function (fileName) {
    modules[fileName] = require (path.join (modulePath, fileName));

    if (modules[fileName].hasOwnProperty ('xcraftCommands')) {
      modules[fileName].xcraftCommands ().forEach (function (cmd) {
        var commandName = fileName.replace (/\.js$/, '') + '.' + cmd.name;
        busCommander.registerCommandHandler (commandName, cmd.desc, cmd.options, cmd.handler);
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
  return require ('./lib/message.js') ();
};

/**
 * Boot
 *
 * @param {Object[]} commandHandlers - List of modules.
 */
exports.boot = function (commandHandlers) {
  xLog.verb ('Booting...');

  /* init all boot chain */
  async.auto ({
    taskToken: function (callback) {
      generateBusToken (function (err, genToken) {
        xLog.verb ('Bus token created: %s', genToken);
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
      xLog.err (err);
    }
  });
};

exports.stop = function () {
  xLog.verb ('Buses stop called');
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
