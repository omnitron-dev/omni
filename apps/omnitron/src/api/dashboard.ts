// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import * as path from 'path';
import * as blessed from 'blessed';
import { sprintf } from 'sprintf-js';

interface DashboardType {
  screen?: blessed.Widgets.Screen;
  logLines?: { [key: string]: string[] };
  list?: blessed.Widgets.ListElement;
  logBox?: blessed.Widgets.ListElement;
  metadataBox?: blessed.Widgets.BoxElement;
  metricsBox?: blessed.Widgets.ListElement;
  box4?: blessed.Widgets.TextElement;
  init: () => DashboardType;
  refresh: (processes: any[]) => DashboardType;
  log: (type: string, data: any) => DashboardType;
}

const DEFAULT_PADDING = {
  top: 0,
  left: 1,
  right: 1,
};

const WIDTH_LEFT_PANEL = 30;

const Dashboard: DashboardType = {
  init() {
    // Init Screen
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
    });
    this.screen.title = 'OMNITRON Dashboard';

    this.logLines = {};

    this.list = blessed.list({
      top: '0',
      left: '0',
      width: WIDTH_LEFT_PANEL + '%',
      height: '70%',
      padding: 0,
      scrollbar: {
        ch: ' ',
        inverse: false,
      },
      border: {
        type: 'line',
      },
      keys: true,
      autoCommandKeys: true,
      tags: true,
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
        },
        scrollbar: {
          bg: 'blue',
          fg: 'black',
        },
        fg: 'white',
        border: {
          fg: 'blue',
        },
        header: {
          fg: 'blue',
        },
      },
    });

    this.list.on('select item', (item, i) => {
      this.logBox.clearItems();
    });

    this.logBox = blessed.list({
      label: ' Logs ',
      top: '0',
      left: WIDTH_LEFT_PANEL + '%',
      width: 100 - WIDTH_LEFT_PANEL + '%',
      height: '70%',
      padding: DEFAULT_PADDING,
      scrollable: true,
      scrollbar: {
        ch: ' ',
        inverse: false,
      },
      keys: true,
      autoCommandKeys: true,
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'white',
        },
        scrollbar: {
          bg: 'blue',
          fg: 'black',
        },
      },
    });

    this.metadataBox = blessed.box({
      label: ' Metadata ',
      top: '70%',
      left: WIDTH_LEFT_PANEL + '%',
      width: 100 - WIDTH_LEFT_PANEL + '%',
      height: '26%',
      padding: DEFAULT_PADDING,
      scrollable: true,
      scrollbar: {
        ch: ' ',
        inverse: false,
      },
      keys: true,
      autoCommandKeys: true,
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'white',
        },
        scrollbar: {
          bg: 'blue',
          fg: 'black',
        },
      },
    });

    this.metricsBox = blessed.list({
      label: ' Custom Metrics ',
      top: '70%',
      left: '0%',
      width: WIDTH_LEFT_PANEL + '%',
      height: '26%',
      padding: DEFAULT_PADDING,
      scrollbar: {
        ch: ' ',
        inverse: false,
      },
      keys: true,
      autoCommandKeys: true,
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        fg: 'white',
        border: {
          fg: 'white',
        },
        scrollbar: {
          bg: 'blue',
          fg: 'black',
        },
      },
    });

    this.box4 = blessed.text({
      content:
        ' left/right: switch boards | up/down/mouse: scroll | Ctrl-C: exit{|} {cyan-fg}{bold}To go further check out https://omnitron.io/{/}  ',
      left: '0%',
      top: '95%',
      width: '100%',
      height: '6%',
      valign: 'middle',
      tags: true,
      style: {
        fg: 'white',
      },
    });

    this.list.focus();

    this.screen.append(this.list);
    this.screen.append(this.logBox);
    this.screen.append(this.metadataBox);
    this.screen.append(this.metricsBox);
    this.screen.append(this.box4);

    this.list.setLabel(' Process List ');

    this.screen.render();

    let i = 0;
    const boards = ['list', 'logBox', 'metricsBox', 'metadataBox'];
    this.screen.key(['left', 'right'], (ch, key) => {
      if (key.name === 'left') {
        i--;
      } else {
        i++;
      }
      if (i == 4) i = 0;
      if (i == -1) i = 3;
      this[boards[i]].focus();
      this[boards[i]].style.border.fg = 'blue';
      if (key.name === 'left') {
        if (i == 3) this[boards[0]].style.border.fg = 'white';
        else this[boards[i + 1]].style.border.fg = 'white';
      } else {
        if (i == 0) this[boards[3]].style.border.fg = 'white';
        else this[boards[i - 1]].style.border.fg = 'white';
      }
    });

    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.screen.destroy();
      process.exit(0);
    });

    // async refresh of the ui
    setInterval(() => {
      this.screen.render();
    }, 300);

    return this;
  },

  refresh(processes) {
    if (!processes) {
      this.list.setItem(0, 'No process available');
      return this;
    }

    if (processes.length != this.list.items.length) {
      this.list.clearItems();
    }

    // Total of processes memory
    let mem = 0;
    processes.forEach(function (proc) {
      mem += proc.monit.memory;
    });

    // Sort process list
    processes.sort(function (a, b) {
      if (a.omnitron_env.name < b.omnitron_env.name) return -1;
      if (a.omnitron_env.name > b.omnitron_env.name) return 1;
      return 0;
    });

    // Loop to get process infos
    for (let i = 0; i < processes.length; i++) {
      // Percent of memory use by one process in all omnitron processes
      const memPercent = (processes[i].monit.memory / mem) * 100;

      // Status of process
      let status = processes[i].omnitron_env.status == 'online' ? '{green-fg}' : '{red-fg}';
      status = status + '{bold}' + processes[i].omnitron_env.status + '{/}';

      const name = processes[i].omnitron_env.name || path.basename(processes[i].omnitron_env.pm_exec_path);

      // Line of list
      const item = sprintf(
        '[%2s] %s {|} Mem: {bold}{%s-fg}%3d{/} MB    CPU: {bold}{%s-fg}%2d{/} %s  %s',
        processes[i].omnitron_env.pm_id,
        name,
        gradient(memPercent, [255, 0, 0], [0, 255, 0]),
        (processes[i].monit.memory / 1048576).toFixed(2),
        gradient(processes[i].monit.cpu, [255, 0, 0], [0, 255, 0]),
        processes[i].monit.cpu,
        '%',
        status
      );

      // Check if item exist
      if (this.list.getItem(i)) {
        this.list.setItem(i, item);
      } else {
        this.list.pushItem(item);
      }

      const proc = processes[this.list.selected];
      // render the logBox
      const process_id = proc.pm_id;
      const logs = this.logLines[process_id];
      if (typeof logs !== 'undefined') {
        this.logBox.setItems(logs);
        if (!this.logBox.focused) {
          this.logBox.setScrollPerc(100);
        }
      } else {
        this.logBox.clearItems();
      }
      this.logBox.setLabel(`  ${proc.omnitron_env.name} Logs  `);

      this.metadataBox.setLine(0, 'App Name              ' + '{bold}' + proc.omnitron_env.name + '{/}');
      this.metadataBox.setLine(1, 'Namespace             ' + '{bold}' + proc.omnitron_env.namespace + '{/}');
      this.metadataBox.setLine(2, 'Version               ' + '{bold}' + proc.omnitron_env.version + '{/}');
      this.metadataBox.setLine(3, 'Restarts              ' + proc.omnitron_env.restart_time);
      this.metadataBox.setLine(
        4,
        'Uptime                ' +
          (proc.omnitron_env.pm_uptime && proc.omnitron_env.status == 'online'
            ? timeSince(proc.omnitron_env.pm_uptime)
            : 0)
      );
      this.metadataBox.setLine(5, 'Script path           ' + proc.omnitron_env.pm_exec_path);
      this.metadataBox.setLine(
        6,
        'Script args           ' +
          (proc.omnitron_env.args
            ? (typeof proc.omnitron_env.args == 'string'
                ? JSON.parse(proc.omnitron_env.args.replace(/'/g, '"'))
                : proc.omnitron_env.args
              ).join(' ')
            : 'N/A')
      );
      this.metadataBox.setLine(7, 'Interpreter           ' + proc.omnitron_env.exec_interpreter);
      this.metadataBox.setLine(
        8,
        'Interpreter args      ' + (proc.omnitron_env.node_args.length != 0 ? proc.omnitron_env.node_args : 'N/A')
      );
      this.metadataBox.setLine(
        9,
        'Exec mode             ' +
          (proc.omnitron_env.exec_mode == 'fork_mode' ? '{bold}fork{/}' : '{blue-fg}{bold}cluster{/}')
      );
      this.metadataBox.setLine(10, 'Node.js version       ' + proc.omnitron_env.node_version);
      this.metadataBox.setLine(
        11,
        'watch & reload        ' + (proc.omnitron_env.watch ? '{green-fg}{bold}✔{/}' : '{red-fg}{bold}✘{/}')
      );
      this.metadataBox.setLine(12, 'Unstable restarts     ' + proc.omnitron_env.unstable_restarts);

      this.metadataBox.setLine(
        13,
        'Comment               ' + (proc.omnitron_env.versioning ? proc.omnitron_env.versioning.comment : 'N/A')
      );
      this.metadataBox.setLine(
        14,
        'Revision              ' + (proc.omnitron_env.versioning ? proc.omnitron_env.versioning.revision : 'N/A')
      );
      this.metadataBox.setLine(
        15,
        'Branch                ' + (proc.omnitron_env.versioning ? proc.omnitron_env.versioning.branch : 'N/A')
      );
      this.metadataBox.setLine(
        16,
        'Remote url            ' + (proc.omnitron_env.versioning ? proc.omnitron_env.versioning.url : 'N/A')
      );
      this.metadataBox.deleteLine(17);
      this.metadataBox.setLine(
        17,
        'Last update           ' + (proc.omnitron_env.versioning ? proc.omnitron_env.versioning.update_time : 'N/A')
      );

      if (Object.keys(proc.omnitron_env.axm_monitor).length != this.metricsBox.items.length) {
        this.metricsBox.clearItems();
      }
      let j = 0;
      for (const key in proc.omnitron_env.axm_monitor) {
        const metric_name = Object.prototype.hasOwnProperty.call(proc.omnitron_env.axm_monitor[key], 'value')
          ? proc.omnitron_env.axm_monitor[key].value
          : proc.omnitron_env.axm_monitor[key];
        const metric_unit = Object.prototype.hasOwnProperty.call(proc.omnitron_env.axm_monitor[key], 'unit')
          ? proc.omnitron_env.axm_monitor[key].unit
          : null;
        const probe = `{bold}${key}{/} {|} ${metric_name}${metric_unit == null ? '' : ' ' + metric_unit}`;

        if (this.metricsBox.getItem(j)) {
          this.metricsBox.setItem(j, probe);
        } else {
          this.metricsBox.pushItem(probe);
        }
        j++;
      }

      this.screen.render();
    }

    return this;
  },

  log(type, data) {
    if (typeof this.logLines[data.process.pm_id] === 'undefined') {
      this.logLines[data.process.pm_id] = [];
    }
    // Logs colors
    let color: string;
    switch (type) {
      case 'OMNITRON':
        color = '{blue-fg}';
        break;
      case 'out':
        color = '{green-fg}';
        break;
      case 'err':
        color = '{red-fg}';
        break;
      default:
        color = '{white-fg}';
    }

    const logs = data.data.split('\n');

    logs.forEach((log: string) => {
      if (log.length > 0) {
        this.logLines[data.process.pm_id].push(color + data.process.name + '{/} > ' + log);

        //removing logs if longer than limit
        let count = 0;
        let max_count = 0;
        let leading_process_id = -1;

        for (const process_id in this.logLines) {
          count += this.logLines[process_id].length;
          if (this.logLines[process_id].length > max_count) {
            leading_process_id = process_id;
            max_count = this.logLines[process_id].length;
          }
        }

        if (count > 200) {
          this.logLines[leading_process_id].shift();
        }
      }
    });

    return this;
  },
};

export = Dashboard;

function timeSince(date: number) {
  const seconds = Math.floor((new Date().getTime() - date) / 1000);

  let interval = Math.floor(seconds / 31536000);

  if (interval > 1) {
    return interval + 'Y';
  }
  interval = Math.floor(seconds / 2592000);
  if (interval > 1) {
    return interval + 'M';
  }
  interval = Math.floor(seconds / 86400);
  if (interval > 1) {
    return interval + 'D';
  }
  interval = Math.floor(seconds / 3600);
  if (interval > 1) {
    return interval + 'h';
  }
  interval = Math.floor(seconds / 60);
  if (interval > 1) {
    return interval + 'm';
  }
  return Math.floor(seconds) + 's';
}

/* Args :
 *  p : Percent 0 - 100
 *  rgb_ : Array of rgb [255, 255, 255]
 * Return :
 *  Hexa #FFFFFF
 */
function gradient(p: number, rgb_beginning: number[], rgb_end: number[]) {
  const w = (p / 100) * 2 - 1;

  const w1 = (w + 1) / 2.0;
  const w2 = 1 - w1;

  const rgb = [
    parseInt((rgb_beginning[0] * w1 + rgb_end[0] * w2).toString()),
    parseInt((rgb_beginning[1] * w1 + rgb_end[1] * w2).toString()),
    parseInt((rgb_beginning[2] * w1 + rgb_end[2] * w2).toString()),
  ];

  // eslint-disable-next-line no-bitwise
  return '#' + ((1 << 24) + (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]).toString(16).slice(1);
}
