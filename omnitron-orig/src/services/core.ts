import os from 'os';
import fs from 'fs';
import { Public, Service } from '@devgrid/netron';

export interface ICoreService {
  processInfo(): Promise<Record<string, any>>;
}

@Service('core')
export class CoreService implements ICoreService {
  constructor() { }

  @Public()
  async processInfo(): Promise<Record<string, any>> {
    const pid = process.pid;
    const processInfo: Record<string, any> = {
      parentProcessId: process.ppid,
      pid,
      exec: process.argv.join(' '),
      currentWorkingDirectory: process.cwd(),
      processUptimeInSeconds: `${process.uptime().toFixed(2)} секунд`,
      userCpuUsageInMilliseconds: `${(process.cpuUsage().user / 1000).toFixed(2)} ms`,
      systemCpuUsageInMilliseconds: `${(process.cpuUsage().system / 1000).toFixed(2)} ms`,
      memoryUsageRssInMegabytes: `${(process.memoryUsage().rss / (1024 * 1024)).toFixed(2)} MB`,
      memoryUsageHeapTotalInMegabytes: `${(process.memoryUsage().heapTotal / (1024 * 1024)).toFixed(2)} MB`,
      memoryUsageHeapUsedInMegabytes: `${(process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)} MB`,
      memoryUsageExternalInMegabytes: `${(process.memoryUsage().external / (1024 * 1024)).toFixed(2)} MB`,
      userCpuTimeInMilliseconds: process.resourceUsage
        ? `${(process.resourceUsage().userCPUTime / 1000).toFixed(2)} ms`
        : null,
      systemCpuTimeInMilliseconds: process.resourceUsage
        ? `${(process.resourceUsage().systemCPUTime / 1000).toFixed(2)} ms`
        : null,
      maxRssInKilobytes: process.resourceUsage ? `${(process.resourceUsage().maxRSS / 1024).toFixed(2)} KB` : null,
      fileDescriptors: null,
    };

    try {
      // ✅ Получаем список открытых файлов (Linux/macOS)
      if (os.platform() !== 'win32') {
        const fdPath = `/proc/${pid}/fd`;
        if (fs.existsSync(fdPath)) {
          processInfo.fileDescriptors = fs.readdirSync(fdPath).length;
        }
      }
    } catch (error: any) {
      // ignore
    }

    return processInfo;
  }
}
