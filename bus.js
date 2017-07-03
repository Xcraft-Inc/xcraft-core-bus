'use strict';

const path = require ('path');
const xBus = require ('.');

const cmds = {};
const watched = {};

function getModuleFiles (file) {
  return file ? [file] : xBus.runningModuleLocations ();
}

function getModuleNames (name) {
  return name ? [name] : xBus.runningModuleNames ();
}

cmds['module.load'] = function* (msg, resp) {
  const {files} = msg.data;
  const modFiles = !files.length ? getModuleFiles () : files;

  const dirname = path.dirname (modFiles[0]);
  const filenames = modFiles.map (file => path.basename (file));

  //READ DEF: FIND HOT
  try {
    yield xBus.loadModule (resp, filenames, dirname, false);
    resp.log.info (`module(s) ${filenames.join (', ')} successfully loaded`);
  } catch (ex) {
    resp.log.warn (ex.stack);
  }

  resp.events.send (`bus.module.load.${msg.id}.finished`);
};

cmds['module.unload'] = function* (msg, resp) {
  const {names} = msg.data;
  const modNames = !names.length ? getModuleNames () : names;

  try {
    yield xBus.unloadModule (resp, modNames);
    resp.log.info (`module(s) ${modNames.join (', ')} successfully unloaded`);
  } catch (ex) {
    resp.log.warn (ex.stack);
  }

  resp.events.send (`bus.module.unload.${msg.id}.finished`);
};

cmds['module.reload'] = function* (msg, resp) {
  const {files} = msg.data;
  const modFiles = !files.length ? getModuleFiles () : files;

  const dirname = path.dirname (modFiles[0]);
  const filenames = modFiles.map (file => path.basename (file));

  try {
    yield xBus.reloadModule (resp, filenames, dirname);
    resp.log.info (`module(s) ${filenames.join (', ')} successfully reloaded`);
  } catch (ex) {
    resp.log.err (ex.stack);
  }

  resp.events.send (`bus.module.reload.${msg.id}.finished`);
};

cmds['module.watch'] = function* (msg, resp, next) {
  const chokidar = require ('chokidar');
  const {file} = msg.data;
  const files = getModuleFiles (file);

  const dirList = new Set ();

  for (const file of files) {
    const dirname = path.dirname (file);

    if (dirList.has (dirname)) {
      continue;
    }

    dirList.add (dirname);

    if (watched[dirname]) {
      watched[dirname].handle.close ();
    }

    const _next = next.parallel ();

    watched[dirname] = {
      handle: chokidar
        .watch (dirname)
        .on ('all', (event, location) => {
          if (!watched[dirname].ready) {
            return;
          }

          resp.log.info (`file ${location} has changed, reload...`);
          const modFiles = files.filter (file => file.startsWith (dirname));
          resp.command.send ('bus.module.reload', {files: modFiles}, () => {});
        })
        .on ('ready', () => {
          watched[dirname].ready = true;
          _next ();
        })
        .on ('error', err => {
          resp.log.err (err);
          _next (err);
        }),
      ready: false,
    };
  }

  yield next.sync ();

  resp.log.verb (`watched modules: ${Object.keys (watched).join (', ')}`);
  resp.events.send (`bus.module.watch.${msg.id}.finished`);
};

cmds['module.unwatch'] = function (msg, resp) {
  const {file} = msg.data;
  const dirnames = getModuleFiles (file).map (file => path.dirname (file));

  dirnames.filter (dirname => !!watched[dirname]).forEach (dirname => {
    resp.log.info (`stop watching for ${dirname}`);
    watched[dirname].handle.close ();
    delete watched[dirname];
  });

  resp.log.verb (`watched modules: ${Object.keys (watched).join (', ')}`);
  resp.events.send (`bus.module.unwatch.${msg.id}.finished`);
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmds,
    rc: {
      'module.load': {
        parallel: false,
        desc: 'load a module',
        options: {
          params: {
            optional: 'files...',
          },
        },
      },
      'module.unload': {
        parallel: false,
        desc: 'unload a module',
        options: {
          params: {
            optional: 'names...',
          },
        },
      },
      'module.reload': {
        parallel: false,
        desc: 'reload a module',
        options: {
          params: {
            optional: 'files...',
          },
        },
      },
      'module.watch': {
        parallel: true,
        desc: 'start watching for module auto-reload',
        options: {
          params: {
            optional: 'file',
          },
        },
      },
      'module.unwatch': {
        parallel: true,
        desc: 'stop watching for module auto-reload',
        options: {
          params: {
            optional: 'file',
          },
        },
      },
    },
  };
};
