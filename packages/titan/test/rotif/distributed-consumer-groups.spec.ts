import { delay } from '@omnitron-dev/common';

import { NotificationManager } from '../src';
import { getTestRedisUrl } from './helpers/test-utils';

describe('Distributed Rotif Instances – Consumer Group Handling', () => {
  let managerA: NotificationManager;
  let managerB: NotificationManager;

  afterEach(async () => {
    await managerA?.stopAll();
    await managerB?.stopAll();
  });

  it('Multiple instances, same consumer group, localRoundRobin = false', async () => {
    managerA = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: false, blockInterval: 100 });
    managerB = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: false, blockInterval: 100 });

    const receivedA: any[] = [];
    const receivedB: any[] = [];

    await managerA.subscribe('distributed.same-group', async (msg) => { receivedA.push(msg.payload) });
    await managerB.subscribe('distributed.same-group', async (msg) => { receivedB.push(msg.payload) });

    await delay(200);
    await managerA.publish('distributed.same-group', { data: 'shared' });

    await delay(1000);

    expect(receivedA.length + receivedB.length).toBe(1);
  });

  it('Multiple instances, same consumer group, localRoundRobin = true', async () => {
    managerA = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: true, blockInterval: 100 });
    managerB = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: true, blockInterval: 100 });

    const receivedA1: any[] = [];
    const receivedA2: any[] = [];
    const receivedB1: any[] = [];
    const receivedB2: any[] = [];

    await managerA.subscribe('distributed.roundrobin', async (msg) => { receivedA1.push(msg.payload) });
    await managerA.subscribe('distributed.roundrobin', async (msg) => { receivedA2.push(msg.payload) });

    await managerB.subscribe('distributed.roundrobin', async (msg) => { receivedB1.push(msg.payload) });
    await managerB.subscribe('distributed.roundrobin', async (msg) => { receivedB2.push(msg.payload) });

    await delay(200);
    await managerA.publish('distributed.roundrobin', { data: 'round-robin' });
    await managerA.publish('distributed.roundrobin', { data: 'round-robin-2' });

    await delay(1000);

    // Two messages should be distributed randomly between two instances,
    // with a maximum of 1 message per subscriber within each instance
    expect(receivedA1.length + receivedA2.length + receivedB1.length + receivedB2.length).toBe(2);
    expect(Math.max(receivedA1.length, receivedA2.length)).toBeLessThanOrEqual(1);
    expect(Math.max(receivedB1.length, receivedB2.length)).toBeLessThanOrEqual(1);
  });

  it('Multiple instances, different consumer groups, localRoundRobin = false', async () => {
    managerA = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: false, blockInterval: 100 });
    managerB = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: false, blockInterval: 100 });

    const receivedA: any[] = [];
    const receivedB: any[] = [];

    await managerA.subscribe('distributed.diff-groups', async (msg) => { receivedA.push(msg.payload) }, { groupName: 'groupA' });
    await managerB.subscribe('distributed.diff-groups', async (msg) => { receivedB.push(msg.payload) }, { groupName: 'groupB' });

    await delay(200);
    await managerA.publish('distributed.diff-groups', { data: 'different-groups' });

    await delay(1000);

    expect(receivedA.length).toBe(1);
    expect(receivedB.length).toBe(1);
  });

  it('Multiple instances, different consumer groups, localRoundRobin = true', async () => {
    managerA = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: true, blockInterval: 100 });
    managerB = new NotificationManager({ redis: getTestRedisUrl(1), localRoundRobin: true, blockInterval: 100 });

    const receivedA1: any[] = [];
    const receivedA2: any[] = [];
    const receivedB1: any[] = [];
    const receivedB2: any[] = [];

    await managerA.subscribe('distributed.diff-groups-rr', async (msg) => { receivedA1.push(msg.payload) }, { groupName: 'groupA' });
    await managerA.subscribe('distributed.diff-groups-rr', async (msg) => { receivedA2.push(msg.payload) }, { groupName: 'groupA' });

    await managerB.subscribe('distributed.diff-groups-rr', async (msg) => { receivedB1.push(msg.payload) }, { groupName: 'groupB' });
    await managerB.subscribe('distributed.diff-groups-rr', async (msg) => { receivedB2.push(msg.payload) }, { groupName: 'groupB' });

    await delay(200);
    await managerA.publish('distributed.diff-groups-rr', { data: 'diff-groups-rr' });
    await managerA.publish('distributed.diff-groups-rr', { data: 'diff-groups-rr-2' });

    await delay(1000);

    expect(receivedA1.length + receivedA2.length).toBe(2); // both messages reached group A
    expect(receivedB1.length + receivedB2.length).toBe(2); // both messages reached group B

    expect(Math.max(receivedA1.length, receivedA2.length)).toBe(1); // Round-robin in group A
    expect(Math.max(receivedB1.length, receivedB2.length)).toBe(1); // Round-robin in group B
  });
});
