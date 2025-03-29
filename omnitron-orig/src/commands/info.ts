import { RemotePeer } from '@devgrid/netron';

import { Runtime } from '../runtime';
import { formatTable } from '../utils';
import { ICoreService } from '../services';

const HUMAN_READABLE_KEYS: Record<string, string> = {
  parentProcessId: 'Parent Process ID',
  pid: 'Process ID',
  exec: 'Executable',
  currentWorkingDirectory: 'Current Working Directory',
  processUptimeInSeconds: 'Process Uptime',
  userCpuUsageInMilliseconds: 'User CPU Usage',
  systemCpuUsageInMilliseconds: 'System CPU Usage',
  memoryUsageRssInMegabytes: 'Memory Usage RSS',
  memoryUsageHeapTotalInMegabytes: 'Heap Total Memory Usage',
  memoryUsageHeapUsedInMegabytes: 'Heap Used Memory',
  memoryUsageExternalInMegabytes: 'External Memory Usage',
  userCpuTimeInMilliseconds: 'User CPU Time',
  systemCpuTimeInMilliseconds: 'System CPU Time',
  maxRssInKilobytes: 'Max RSS',
  fileDescriptors: 'File Descriptors',
};

export default async function info(options: { json?: boolean }): Promise<void> {
  const peer = Runtime.get().get('peer') as RemotePeer;

  const iCore = (await peer.queryInterface('core')) as ICoreService;
  const processInfo = await iCore.processInfo();

  if (options.json) {
    console.log(JSON.stringify(processInfo, null, 2));
  } else {
    const humanReadableProcessInfo: Record<string, any> = {};
    for (const [key, value] of Object.entries(processInfo)) {
      const humanReadableKey = HUMAN_READABLE_KEYS[key] || key;
      humanReadableProcessInfo[humanReadableKey] = value;
    }
    console.log(formatTable(humanReadableProcessInfo));
  }
}
