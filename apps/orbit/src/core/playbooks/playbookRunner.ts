import { Task } from '../tasks/task';
import { Playbook } from './playbook';
import { Host } from '../inventory/host';
import { OrbitResult, OrbitContext } from '../../types/common';
import { OrbitEvent, OrbitEvents, PlaybookEventPayload } from '../events/orbitEvents';

export class PlaybookRunner {
  constructor(private context: OrbitContext) { }

  async run(playbook: Playbook, hosts: Host[]): Promise<Record<string, OrbitResult[]>> {
    const results: Record<string, OrbitResult[]> = {};

    // Событие запуска плейбука
    OrbitEvents.emit(OrbitEvent.PlaybookStart, {
      playbookName: playbook.name,
      timestamp: new Date(),
      dryRun: this.context.config.dryRun,
    } as PlaybookEventPayload);

    this.context.logger.info(`Starting playbook "${playbook.name}" execution`, {
      dryRun: this.context.config.dryRun,
      hosts: hosts.map(h => h.hostname),
    });

    for (const host of hosts) {
      results[host.hostname] = [];
      const executedTasks: Task[] = [];

      for (const task of playbook.getTasks()) {
        const result = await task.executeWithRetry(host, this.context);
        results[host.hostname]?.push(result);

        if (result.success) {
          executedTasks.push(task);
        } else {
          this.context.logger.warn(`Task "${task.name}" failed on host "${host.hostname}". Initiating rollback.`);

          // Rollback executed tasks in reverse order
          for (const rollbackTask of executedTasks.reverse()) {
            this.context.logger.info(`Rolling back task "${rollbackTask.name}" on host "${host.hostname}"`);
            await rollbackTask.rollback(host, this.context);
          }

          break; // stop further tasks execution on error
        }
      }
    }

    // Событие завершения плейбука
    OrbitEvents.emit(OrbitEvent.PlaybookComplete, {
      playbookName: playbook.name,
      timestamp: new Date(),
      dryRun: this.context.config.dryRun,
    } as PlaybookEventPayload);

    this.context.logger.info(`Playbook "${playbook.name}" completed`, {
      dryRun: this.context.config.dryRun,
    });

    return results;
  }
}
