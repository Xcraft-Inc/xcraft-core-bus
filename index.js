/* Buses Booting */
'use strict';

var moduleName   = 'bus';

var watt   = require ('watt');
var orcish = require ('./lib/orcish.js');

var busNotifier  = require ('./lib/notifier.js');
var busCommander = require ('./lib/commander.js');

var xLog      = require ('xcraft-core-log') (moduleName, null);
var busConfig = require ('xcraft-core-etc') ().load ('xcraft-core-bus');

var EventEmitter = require ('events').EventEmitter;

var bootReady = false;
var token     = '';
var emitter   = new EventEmitter ();
var notifier  = {};
var commander = {};


function registerCommand (name, rc, handler) {
  /* register commands as activity */
  busCommander.registerCommandHandler (
    name,
    rc && rc.desc     || null,
    rc && rc.options  || {},
    true,
    rc && rc.parallel || false,
    handler
  );
}

/**
 * Browse /scripts for zog modules, and register exported xcraftCommands.
 * (Activities).
 */
var loadCommandsRegistry = function (modulePath, filterRegex) {
  var path = require ('path');
  var xFs  = require ('xcraft-core-fs');

  var modules = {};
  var modulesFiles = xFs.ls (modulePath, filterRegex);

  modulesFiles.forEach (function (fileName) {
    modules[fileName] = require (path.join (modulePath, fileName));

    if (modules[fileName].hasOwnProperty ('xcraftCommands')) {
      const cmds = modules[fileName].xcraftCommands ();
      const rc   = cmds.rc || {};

      Object.keys (cmds.handlers).forEach ((action) => {
        const name = fileName.replace (/\.js$/, '') + '.' + action;
        registerCommand (name, rc[action], cmds.handlers[action]);
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
 * Boot buses.
 *
 * @param {Object[]} commandHandlers - List of modules.
 * @param {function(err)} next
 */
exports.boot = watt (function * (commandHandlers, next) {
  xLog.verb ('Booting...');

  /* Generate the token */
  const genToken = yield orcish.generateGreatHall (next);
  xLog.info ('Great Hall created: %s', genToken);
  token = genToken;

  /* load some command handler from modules/scripts locations */
  Object.keys (commandHandlers).forEach (function (index) {
    loadCommandsRegistry (commandHandlers[index].path,
                          commandHandlers[index].pattern);
  });

  /* Start the bus commander */
  busCommander.start (busConfig.host,
                      parseInt (busConfig.commanderPort),
                      genToken,
                      next.parallel ());

  /* Start the bus notifier */
  busNotifier.start (busConfig.host,
                     parseInt (busConfig.notifierPort),
                     next.parallel ());

  yield next.sync ();

  notifier  = busNotifier.bus;
  commander = busCommander;
  bootReady = true;
  emitter.emit ('ready');
});

exports.stop = function () {
  xLog.verb ('Buses stop called, stopping services and sending GameOver...');

  var busClient = require ('xcraft-core-busclient').getGlobal ();
  var msg = busClient.newMessage ();
  notifier.send ('gameover', msg);

  emitter.emit ('stop');
  busCommander.stop ();
  busNotifier.stop ();
};
