import { createDaemonClient } from '../daemon/daemon-client.js';
import {
  readSystemSnapshot,
  type IOmnitronNodesService,
  type IOmnitronSystemInfoService,
} from '../shared/dto/services.js';
import { formatBytes, formatUptime } from '../shared/format.js';
import { emitError, emitInfo, emitJson } from './output.js';

export async function systemCommand({ node }: { node?: string }): Promise<void> {
  const client = createDaemonClient();
  try {
    const snapshot = node
      ? await (await client.service<IOmnitronNodesService>('OmnitronNodes')).getNodeSystemSnapshot({ nodeId: node })
      : await (await client.service<IOmnitronSystemInfoService>('OmnitronSystemInfo')).getSnapshot({ fresh: true });
    const { missing, timing, complete } = readSystemSnapshot(snapshot);
    if (!complete) process.exitCode = 1;
    if (emitJson({ target: node ?? null, timing, complete, snapshot })) return;
    const { os, cpu, memory, daemon, unanswered, network, disks, docker } = snapshot;
    emitInfo(
      `${node ?? 'Connected daemon'} · ${(!unanswered.os && os.hostname) || 'hostname unavailable'} · ${new Date(snapshot.timestamp).toISOString()} (${timing}, ${snapshot.collectedMs} ms)`
    );
    emitInfo(
      `Daemon ${daemon.role} · PID ${daemon.pid} · Node ${daemon.nodeVersion} · up ${formatUptime(daemon.uptimeMs)}${daemon.build ? ` · ${daemon.build.commit}` : ''}`
    );
    if (!unanswered.cpu) emitInfo(`CPU ${cpu.currentLoad.toFixed(1)}% · ${cpu.brand} · ${cpu.cores} logical cores`);
    if (!unanswered.memory)
      emitInfo(`Memory ${formatBytes(memory.committed)} committed · ${formatBytes(memory.available)} available`);
    if (!unanswered.disks)
      for (const disk of disks)
        emitInfo(`${disk.mount} · ${disk.usedPercent}% used · ${formatBytes(disk.available)} available`);
    if (!unanswered.network)
      emitInfo(
        `Network · ${network.interfaces.length} interfaces · ${network.rateAvailable !== false && network.rxSec >= 0 && network.txSec >= 0 ? `RX ${formatBytes(network.rxSec)}/s · TX ${formatBytes(network.txSec)}/s` : 'rate unavailable'}`
      );
    if (!unanswered.docker && docker)
      emitInfo(`Docker · ${docker.running} running · ${docker.paused} paused · ${docker.stopped} stopped`);
    for (const [section, reason] of missing) emitInfo(`${section}: ${reason}`);
  } catch (err) {
    process.exitCode = 1;
    emitError(
      `Cannot read system snapshot for ${node ?? 'connected daemon'}: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    await client.disconnect();
  }
}
