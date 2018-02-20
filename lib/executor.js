'use strict';

const EventEmitter = require('events');

const intformat = require('biguint-format');
const FlakeId = require('flake-idgen');

class Executor extends EventEmitter {
  constructor() {
    super();

    this._flakeIdGen = new FlakeId();
    this._waiting = new Map();

    let prevTime = new Date().getTime();

    /* Waiting list handling */
    this.on('wait', () => {
      let timeout = false;

      for (const proc of this._waiting.values()) {
        if (proc.priority === 1) {
          if (timeout) {
            continue;
          }

          const time = new Date().getTime();
          const diff = time - prevTime;
          if (time - prevTime < 20) {
            setTimeout(() => this.emit('wait'), diff);
            timeout = true;
            continue;
          }

          prevTime = time;
        }

        this._waiting.delete(proc.id);
        this.emit('run', proc);
      }
    });

    /* Running list handling */
    this.on('run', proc => {
      /* Effectively run action */
      proc.run(proc.cmd, proc.msg);
    });
  }

  /**
   * Add an activity to execute.
   *
   * The activity is push in the waiting list and executed ASAP.
   *
   * @param  {string} cmd - The command's name.
   * @param  {Object} msg - The associated message.
   * @param  {function()} action - The handler for running the command.
   * @param  {Number} priority - Set the priority (higher number = low priority)
   * @return {undefined}
   */
  execute(cmd, msg, action, priority) {
    if (priority < 0 || priority > 10) {
      throw new Error(
        `The priority can be only between 0..9; the value passed is ${priority}`
      );
    }

    const id = `${priority}-${intformat(this._flakeIdGen.next(), 'hex')}`;

    this._waiting.set(id, {
      id,
      cmd,
      msg,
      run: action,
      priority,
    });

    this.emit('wait');
  }
}

module.exports = new Executor();
