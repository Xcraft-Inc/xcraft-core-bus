'use strict';

const EventEmitter = require('events');

const uuidV4 = require('uuid/v4');

class Executor extends EventEmitter {
  constructor() {
    super();

    let prevTime = new Date().getTime();

    this._waiting = {};
    this._waiting[0] = new Map();
    this._waiting[1] = new Map();

    /* Waiting list handling */
    this.on('wait', () => {
      let timeout = false;

      let waiting = null;
      let priority = 0;
      if (this._waiting[0].size) {
        waiting = this._waiting[0];
        priority = 0;
      } else {
        waiting = this._waiting[1];
        priority = 1;
      }

      for (const proc of waiting.values()) {
        if (priority === 1) {
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

        waiting.delete(proc.id);
        proc.run(proc.cmd, proc.msg);
      }
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
    if (priority < 0 || priority > 1) {
      throw new Error(
        `The priority can be only between 0..1; the value passed is ${priority}`
      );
    }

    const id = uuidV4();

    this._waiting[priority].set(id, {
      id,
      cmd,
      msg,
      run: action,
    });

    this.emit('wait');
  }
}

module.exports = new Executor();
