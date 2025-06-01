// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import fs from 'fs';
import util from 'util';
import chalk from 'ansis';
import dayjs from 'dayjs';
import forEachLimit from 'async/forEachLimit';

interface App {
  path: string;
  type: string;
  app_name: string;
}

interface Packet {
  process: {
    name: string;
    pm_id: string;
    namespace: string;
  };
  data: string;
  at: string;
  event: string;
}

interface Client {
  launchBus(callback: (err: Error | null, bus: any, socket: any) => void): void;
}

const Log: any = {};

const DEFAULT_PADDING = '          ';

/**
 * Tail logs from file stream.
 * @param {Object} apps_list
 * @param {Number} lines
 * @param {Boolean} raw
 * @param {Function} callback
 * @return
 */

Log.tail = function (
  apps_list: App[],
  lines: number,
  raw: boolean,
  callback?: (err: Error | null, data?: any) => void
) {
  if (lines === 0 || apps_list.length === 0) {
    callback?.();
    return;
  }

  const getLastLines = function (
    filename: string,
    lines_: number,
    callback_?: (err: Error | null, data?: any) => void
  ) {
    let chunk = '';
    const size = Math.max(0, fs.statSync(filename).size - lines_ * 200);

    const fd = fs.createReadStream(filename, { start: size });
    fd.on('data', (data: Buffer) => {
      chunk += data.toString();
    });
    fd.on('end', () => {
      chunk = chunk.split('\n').slice(-(lines_ + 1));
      chunk.pop();
      callback_?.(chunk);
    });
  };

  apps_list.sort(
    (a, b) =>
      (fs.existsSync(a.path) ? fs.statSync(a.path).mtime.valueOf() : 0) -
      (fs.existsSync(b.path) ? fs.statSync(b.path).mtime.valueOf() : 0)
  );

  forEachLimit(
    apps_list,
    1,
    (app: App, next: (err?: Error | null) => void) => {
      if (!fs.existsSync(app.path || '')) {
        next();
        return;
      }

      getLastLines(app.path, lines, (output: string[]) => {
        console.log(chalk.gray('%s last %d lines:'), app.path, lines);
        output.forEach((out) => {
          if (raw) {
            if (app.type === 'err') {
              console.error(out);
            } else {
              console.log(out);
            }
            return;
          }
          if (app.type === 'out') process.stdout.write(chalk.green(pad(DEFAULT_PADDING, app.app_name) + ' | '));
          else if (app.type === 'err') process.stdout.write(chalk.red(pad(DEFAULT_PADDING, app.app_name) + ' | '));
          else process.stdout.write(chalk.blue(pad(DEFAULT_PADDING, 'OMNITRON') + ' | '));
          console.log(out);
        });
        if (output.length) process.stdout.write('\n');
        next();
      });
    },
    () => {
      callback?.();
    }
  );
};

/**
 * Stream logs in realtime from the bus eventemitter.
 * @param {String} id
 * @param {Boolean} raw
 * @return
 */

Log.stream = function (
  client: Client,
  id: string,
  raw: boolean,
  timestamp: string,
  exclusive: string | boolean,
  highlight: string | boolean
) {
  client.launchBus((err, bus, socket) => {
    socket.on('reconnect attempt', () => {
      if (global._auto_exit === true) {
        if (timestamp) process.stdout.write(chalk['dim'](chalk.gray(dayjs().format(timestamp) + ' ')));
        process.stdout.write(chalk.blue(pad(DEFAULT_PADDING, 'OMNITRON') + ' | ') + '[[[ Target OMNITRON killed. ]]]');
        process.exit(0);
      }
    });

    let min_padding = 3;

    bus.on('log:*', (type: string, packet: Packet) => {
      const isMatchingProcess =
        id === 'all' || packet.process.name == id || packet.process.pm_id == id || packet.process.namespace == id;

      if (!isMatchingProcess) return;

      if (
        (type === 'out' && exclusive === 'err') ||
        (type === 'err' && exclusive === 'out') ||
        (type === 'OMNITRON' && exclusive !== false)
      )
        return;

      let lines: string[];

      if (typeof packet.data === 'string') lines = (packet.data || '').split('\n');
      else return;

      lines.forEach((line) => {
        if (!line || line.length === 0) return;

        if (raw) {
          if (type === 'err') {
            process.stderr.write(util.format(line) + '\n');
          } else {
            process.stdout.write(util.format(line) + '\n');
          }
          return;
        }

        if (timestamp) process.stdout.write(chalk['dim'](chalk.gray(dayjs().format(timestamp) + ' ')));

        const name = packet.process.pm_id + '|' + packet.process.name;

        if (name.length > min_padding) min_padding = name.length + 1;

        if (type === 'out') process.stdout.write(chalk.green(pad(' '.repeat(min_padding), name) + ' | '));
        else if (type === 'err') process.stdout.write(chalk.red(pad(' '.repeat(min_padding), name) + ' | '));
        else if (!raw && (id === 'all' || id === 'OMNITRON'))
          process.stdout.write(chalk.blue(pad(' '.repeat(min_padding), 'OMNITRON') + ' | '));
        if (highlight)
          process.stdout.write(util.format(line).replace(highlight, chalk.bgBlackBright(highlight)) + '\n');
        else process.stdout.write(util.format(line) + '\n');
      });
    });
  });
};

Log.devStream = function (Client: Client, id: string, raw: boolean, timestamp: string, exclusive: string | boolean) {
  Client.launchBus(function (err, bus) {
    setTimeout(function () {
      bus.on('process:event', function (packet: Packet) {
        if (packet.event == 'online') console.log(chalk.green('[rundev] App %s restarted'), packet.process.name);
      });
    }, 1000);

    let min_padding = 3;

    bus.on('log:*', function (type: string, packet: Packet) {
      if (id !== 'all' && packet.process.name != id && packet.process.pm_id != id) return;

      if (
        (type === 'out' && exclusive === 'err') ||
        (type === 'err' && exclusive === 'out') ||
        (type === 'OMNITRON' && exclusive !== false)
      )
        return;

      if (type === 'OMNITRON') return;

      // const name = packet.process.pm_id + '|' + packet.process.name;

      let lines: string[];

      if (typeof packet.data === 'string') lines = (packet.data || '').split('\n');
      else return;

      lines.forEach((line) => {
        if (!line || line.length === 0) return;

        if (raw) {
          process.stdout.write(util.format(line) + '\n');
          return;
        }

        if (timestamp) process.stdout.write(chalk['dim'](chalk.gray(dayjs().format(timestamp) + ' ')));

        const name = packet.process.name + '-' + packet.process.pm_id;

        if (name.length > min_padding) min_padding = name.length + 1;

        if (type === 'out') process.stdout.write(chalk.green(pad(' '.repeat(min_padding), name) + ' | '));
        else if (type === 'err') process.stdout.write(chalk.red(pad(' '.repeat(min_padding), name) + ' | '));
        else if (!raw && (id === 'all' || id === 'OMNITRON'))
          process.stdout.write(chalk.blue(pad(' '.repeat(min_padding), 'OMNITRON') + ' | '));
        process.stdout.write(util.format(line) + '\n');
      });
    });
  });
};

Log.jsonStream = function (Client: Client, id: string) {
  Client.launchBus((err, bus) => {
    if (err) console.error(err);

    bus.on('process:event', (packet: Packet) => {
      process.stdout.write(
        JSON.stringify({
          timestamp: dayjs(packet.at),
          type: 'process_event',
          status: packet.event,
          app_name: packet.process.name,
        })
      );
      process.stdout.write('\n');
    });

    bus.on('log:*', (type: string, packet: Packet) => {
      if (id !== 'all' && packet.process.name != id && packet.process.pm_id != id) return;

      if (type === 'OMNITRON') return;

      if (typeof packet.data == 'string') packet.data = packet.data.replace(/(\r\n|\n|\r)/gm, '');

      process.stdout.write(
        JSON.stringify({
          message: packet.data,
          timestamp: dayjs(packet.at),
          type,
          process_id: packet.process.pm_id,
          app_name: packet.process.name,
        })
      );
      process.stdout.write('\n');
    });
  });
};

Log.formatStream = function (
  Client: Client,
  id: string,
  raw: boolean,
  timestamp: string,
  exclusive: string | boolean,
  highlight: string
) {
  Client.launchBus((err, bus) => {
    bus.on('log:*', (type: string, packet: Packet) => {
      if (id !== 'all' && packet.process.name != id && packet.process.pm_id != id) return;

      if (
        (type === 'out' && exclusive === 'err') ||
        (type === 'err' && exclusive === 'out') ||
        (type === 'OMNITRON' && exclusive !== false)
      )
        return;

      if (type === 'OMNITRON' && raw) return;

      let lines: string[];

      if (typeof packet.data === 'string') lines = (packet.data || '').split('\n');
      else return;

      lines.forEach((line) => {
        if (!line || line.length === 0) return;

        if (!raw) {
          if (timestamp) process.stdout.write('timestamp=' + dayjs().format(timestamp) + ' ');
          if (packet.process.name === 'OMNITRON') process.stdout.write('app=omnitron ');
          if (packet.process.name !== 'OMNITRON')
            process.stdout.write('app=' + packet.process.name + ' id=' + packet.process.pm_id + ' ');
          if (type === 'out') process.stdout.write('type=out ');
          else if (type === 'err') process.stdout.write('type=error ');
        }

        process.stdout.write('message=');
        if (highlight)
          process.stdout.write(util.format(line).replace(highlight, chalk.bgBlackBright(highlight)) + '\n');
        else process.stdout.write(util.format(line) + '\n');
      });
    });
  });
};

function pad(pad_: string, str: string, padLeft: boolean) {
  if (typeof str === 'undefined') return pad_;
  if (padLeft) {
    return (pad_ + str).slice(-pad_.length);
  } else {
    return (str + pad_).substring(0, pad_.length);
  }
}

export default Log;
