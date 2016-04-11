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
      var cmds = modules[fileName].xcraftCommands ();

      var rc    = cmds.rc || {};
      var list  = [];

      Object.keys (cmds.handlers).forEach (function (action) {
        list.push ({
          name:     action,
          desc:     rc[action] && rc[action].desc     || null,
          options:  rc[action] && rc[action].options  || {},
          parallel: rc[action] && rc[action].parallel || false,
          handler:  cmds.handlers[action]
        });
      });

      list.forEach (function (cmd) {
        var commandName = fileName.replace (/\.js$/, '') + '.' + cmd.name;
        /* register commands as activity */
        busCommander.registerCommandHandler (commandName,
                                             cmd.desc,
                                             cmd.options,
                                             true,
                                             cmd.parallel,
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
                      next.parallel);

  /* Start the bus notifier */
  busNotifier.start (busConfig.host,
                     parseInt (busConfig.notifierPort),
                     next.parallel);

  yield next.sync ();

  notifier  = busNotifier.bus;
  commander = busCommander;
  bootReady = true;
  emitter.emit ('ready');

  /* FIXME: Execute all __start__ handlers
  xLog.verb ('starting services...');
  const registry = busCommander.getRegistry ();
  Object
    .keys (registry)
    .filter (cmd => /\.__start__$/.test (cmd))
    .forEach (cmd => busCommander._runCommand (cmd));*/
});

exports.stop = function () {
  xLog.verb ('Buses stop called, stopping services and sending GameOver...');

  /* FIXME: Execute all __stop__ handlers
  const registry = busCommander.getRegistry ();
  Object
    .keys (registry)
    .filter (cmd => /\.__stop__$/.test (cmd))
    .forEach (cmd => busCommander._runCommand (cmd));*/

  var busClient = require ('xcraft-core-busclient').getGlobal ();
  var msg = busClient.newMessage ();
  notifier.send ('gameover', msg);

  emitter.emit ('stop');
  busCommander.stop ();
  busNotifier.stop ();
};
