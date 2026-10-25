import { expect, it, vi } from 'vitest';
const removed = vi.hoisted(() => [] as string[]);
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...(await original<Record<string,unknown>>()),
  removeContainer: async (name:string) => { removed.push(name); },
}));
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { ProjectService } from '../../src/services/project.service.js';
const logger:any={info(){},warn(){},error(){},debug(){},child(){return logger;}};
it('daemon disposal cancels resource monitors without deleting live stack containers; explicit teardown still deletes',async()=>{
  removed.length=0;
  const service:any=new ProjectService(logger,{list:()=>[]} as any,{get:()=>null,set(){}} as any);
  const infra=new InfrastructureService(logger,{services:{}} as any);
  (infra as any).desiredContainers=[{name:'one-prod-postgres'},{name:'one-prod-origin'}];
  (infra as any).usingGlobalOmnitronPg=true;
  const timer=setInterval(()=>{},60000); (infra as any).healthTimer=timer;
  const stop=vi.fn(); (infra as any).phantomJanitor={stop};
  service.infraManager.instances.set('one/prod',infra);
  await service.dispose();
  expect(removed).toEqual([]);
  expect((infra as any).healthTimer).toBeNull();
  expect(stop).toHaveBeenCalledOnce();
  expect(service.infraManager.listInstances()).toEqual([]);
  await infra.teardown();
  expect(removed.sort()).toEqual(['one-prod-origin','one-prod-postgres']);
});
