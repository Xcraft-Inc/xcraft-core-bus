
# xcraft-core-bus

Manage the command and events bus lifecycle and operations.

The command registry is populated on the bootstrap where a list of command
locations is passed. A step looks for all files (in the first directory
level and according to a pattern) and load the modules in order to found
the `xcraftCommands` property.

If this property exists, then the commands are loaded in the registry. Note
that all files in the root path of all modules passed to the bus manager
are required. You must ensure that it's always safe to require any `.js`
files in the root directory of the modules.

Some command handlers are registered separatly.

- autoconnect
- disconnect
- shutdown
- error
- motd
