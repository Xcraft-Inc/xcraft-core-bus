'use strict';

const moduleName = 'bus';

const path = require ('path');
const watt = require ('watt');
const orcish = require ('./lib/orcish.js');

const busNotifier = require ('./lib/notifier.js');
const busCommander = require ('./lib/commander.js');

const xFs = require ('xcraft-core-fs');
const xLog = require ('xcraft-core-log') (moduleName, null);
const busConfig = require ('xcraft-core-etc') ().load ('xcraft-core-bus');

const {EventEmitter} = require ('events');

class Bus extends EventEmitter {
  constructor () {
    super ();

    this._token = '';
    this._notifier = {};
    this._commander = {};

    watt.wrapAll (this);
  }

  static _registerCommand (name, rc, handler) {
    /* register commands as activity */
    busCommander.registerCommandHandler (
      name,
      (rc && rc.desc) || null,
      (rc && rc.options) || {},
      true,
      (rc && rc.parallel) || false,
      handler
    );
  }

  /**
   * Browse /scripts for zog modules, and register exported xcraftCommands.
   * (Activities).
   */
  static _loadCommandsRegistry (modulePath, filterRegex) {
    xFs
      .ls (modulePath, filterRegex)
      .map (fileName => {
        return {
          handle: require (path.join (modulePath, fileName)),
          fileName,
        };
      })
      .filter (mod => mod.handle.hasOwnProperty ('xcraftCommands'))
      .forEach (mod => {
        const cmds = mod.handle.xcraftCommands ();
        const rc = cmds.rc || {};

        Object.keys (cmds.handlers).forEach (action => {
          const name = mod.fileName.replace (/\.js$/, '') + '.' + action;
          Bus._registerCommand (name, rc[action], cmds.handlers[action]);
        });
      });
  }

  generateOrcName () {
    return orcish.generateOrcName ();
  }

  getCommander () {
    return this._commander;
  }

  getNotifier () {
    return this._notifier;
  }

  getToken () {
    return this._token;
  }

  /**
   * Boot buses.
   *
   * @param {Object[]} commandHandlers - List of modules.
   * @param {function(err)} next
   */
  *boot (commandHandlers, next) {
    xLog.verb ('Booting...');

    /* Generate the token */
    const genToken = yield orcish.generateGreatHall (next);
    xLog.info ('Great Hall created: %s', genToken);
    this._token = genToken;

    /* load some command handler from modules/scripts locations */
    Object.keys (commandHandlers).forEach (function (index) {
      Bus._loadCommandsRegistry (
        commandHandlers[index].path,
        commandHandlers[index].pattern
      );
    });

    /* Start the bus commander */
    busCommander.start (
      busConfig.host,
      parseInt (busConfig.commanderPort),
      genToken,
      next.parallel ()
    );

    /* Start the bus notifier */
    busNotifier.start (
      busConfig.host,
      parseInt (busConfig.notifierPort),
      next.parallel ()
    );

    yield next.sync ();

    this._notifier = busNotifier.bus;
    this._commander = busCommander;
    this.emit ('ready');
  }

  stop () {
    xLog.verb ('Buses stop called, stopping services and sending GameOver...');

    const busClient = require ('xcraft-core-busclient').getGlobal ();
    const msg = busClient.newMessage ();
    this._notifier.send ('gameover', msg);

    this.emit ('stop');
    busCommander.stop ();
    busNotifier.stop ();
  }
}

module.exports = new Bus ();
