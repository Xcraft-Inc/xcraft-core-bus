/* Buses Booting */
'use strict';

var moduleName   = 'bus-boot';

var async        = require ('async');
var zogLog       = require ('xcraft-core-log') (moduleName);
var crypto       = require ('crypto');
var busNotifier  = require ('./busNotifier.js');
var busCommander = require ('./busCommander.js');
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
 * Browse /scripts for zog modules, and register exported busCommands.
 */
var loadCommandsRegistry = function (modulePath, filterRegex) {
  var path  = require ('path');
  var zogFs = require ('xcraft-core-fs');

  var zogModules = {};
  var zogModulesFiles = zogFs.ls (modulePath, filterRegex);

  zogModulesFiles.forEach (function (fileName) {
    zogModules[fileName] = require (path.join (modulePath, fileName));

    if (zogModules[fileName].hasOwnProperty ('busCommands')) {
      zogModules[fileName].busCommands ().forEach (function (cmd) {
        var commandName = fileName.replace (/\.js$/, '') + '.' + cmd.name;
        busCommander.registerCommandHandler (commandName, cmd.desc, cmd.handler);
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
* @param busConfig Object with properties {host:, commanderPort:, notifierPort:}
* @param commandHandlers Array of objects with properties [{path:, filePattern:}]
*/
exports.boot = function (busConfig, commandHandlers) {
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
