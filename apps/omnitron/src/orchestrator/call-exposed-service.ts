/**
 * Call a service method on whichever of a bootstrap app's processes exposes it.
 *
 * `omnitron exec` asked the FIRST child's process proxy for
 * `proxy[service][method]`. The proxy answers a remote-call function for ANY
 * property name, so `proxy[service]` was a function and `[method]` on it
 * undefined: `omnitron exec main NotificationWorker getStatus` answered
 * «Method with id NotificationWorker.getStatus not found» for a method that
 * exists — in the notification-worker process, which the first child is not.
 * The working path is the one `ServiceRouter` uses: each process lists the
 * services it exposes (`getExposedServices`) and runs a call on one of them
 * (`callExposedService`).
 *
 * Shared by `exec` and by the alert sink's delivery (services/alert.service.ts),
 * so the operator's command and the daemon's own calls take one road — over the
 * supervisor's socket into the process, never over the app's HTTP transport.
 * Only a method a process lists — one Titan enumerates, `@Public` — is callable.
 *
 * And only in a CHILD: a pool worker (`(worker) ×N` in `omnitron list`) is not
 * among the processes this walks — it is reached through its topology proxy
 * instead. `omnitron exec storage TransformWorker ping` answers «not found»
 * (measured 2026-09-29) while `omnitron exec priceverse CollectorWorker
 * getAllStats`, a `(custom)` child, answers. An alert sink, or anything else
 * called this way, has to live in a `(custom)` child.
 */
import { Errors } from '@omnitron-dev/titan/errors';

interface ExposingProcess {
  getExposedServices?: () => Promise<Array<{ name: string; version?: string; methods: string[] }>>;
  callExposedService?: (service: string, method: string, args: unknown[]) => Promise<unknown>;
}

/** What a bootstrap app's supervisor offers for this: its children, and a proxy into each. */
export interface ExposingSupervisor {
  getChildNames(): string[];
  getChildProxy(child: string): Promise<unknown>;
}

export async function callExposedService(
  supervisor: ExposingSupervisor,
  appName: string,
  service: string,
  method: string,
  args: unknown[]
): Promise<unknown> {
  const childNames = supervisor.getChildNames();
  if (childNames.length === 0) throw Errors.conflict(`No running children for app '${appName}'`);

  const wanted = service.split('@')[0];
  const offered: string[] = [];
  for (const child of childNames) {
    const proxy = (await supervisor.getChildProxy(child)) as ExposingProcess | null;
    if (!proxy?.getExposedServices || !proxy.callExposedService) continue;
    const services = await proxy.getExposedServices();
    const match = services.find((svc) => svc.name === wanted || svc.name.split('@')[0] === wanted);
    if (!match) {
      offered.push(...services.map((svc) => `${svc.name} (${child})`));
      continue;
    }
    if (!match.methods.includes(method)) {
      throw Errors.notFound(
        'Method',
        `${service}.${method} — ${match.name} in ${child} offers: ${match.methods.join(', ') || 'no public methods'}`
      );
    }
    return proxy.callExposedService(service, method, args);
  }
  throw Errors.notFound(
    'Service',
    `${service} in ${appName} — its processes expose: ${offered.join(', ') || 'no services'}`
  );
}
