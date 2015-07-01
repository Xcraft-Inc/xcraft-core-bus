/* Buses Booting */
'use strict';

var moduleName   = 'bus';

var async  = require ('async');
var orcish = require ('./lib/orcish.js');

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

/**
 * Browse /scripts for zog modules, and register exported xcraftCommands.
 * (Activities)
 */
var loadCommandsRegistry = function (modulePath, filterRegex) {
  var path = require ('path');
  var xFs  = require ('xcraft-core-fs');

  var modules = {};
  var modulesFiles = xFs.ls (modulePath, filterRegex);

  modulesFiles.forEach (function (fileName) {
    modules[fileName] = require (path.join (modulePath, fileName));

    if (modules[fileName].hasOwnProperty ('xcraftCommands')) {
      var cmds = modules[fileName].xcraftCommands ();

      var utils = require ('xcraft-core-utils');
      var rc    = cmds.rc && utils.jsonFile2Json (cmds.rc);
      var list  = [];

      Object.keys (cmds.handlers).forEach (function (action) {
        list.push ({
          name:    action,
          desc:    rc && rc[action] ? rc[action].desc    : null,
          options: rc && rc[action] ? rc[action].options : {},
          handler: cmds.handlers[action]
        });
      });

      list.forEach (function (cmd) {
        var commandName = fileName.replace (/\.js$/, '') + '.' + cmd.name;
        /* register commands as activity */
        busCommander.registerCommandHandler (commandName,
                                             cmd.desc,
                                             cmd.options,
                                             true,
                                             cmd.handler);
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

exports.generateOrcName = function () {
  return orcish.generateOrcName ();
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
      orcish.generateGreatHall (function (err, genToken) {
        xLog.info ('Great Hall created: %s', genToken);
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
  xLog.verb ('Buses stop called, sending GameOver...');

  var busClient = require ('xcraft-core-busclient').getGlobal ();
  var msg = busClient.newMessage ();
  notifier.send ('gameover', msg);

  emitter.emit ('stop');
  busCommander.stop ();
  busNotifier.stop ();
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
  default: '9300'
}];
