import { Netron, RemotePeer, WritableStream } from '../dist';

describe.skip('Streams', () => {
  let netron: Netron;
  let netron2: Netron;
  let peer: RemotePeer;
  let peer2: RemotePeer;
  let writable: WritableStream;

  beforeEach(async () => {
    netron = await Netron.create({
      id: 'n1',
      listenHost: 'localhost',
      listenPort: 8080,
    });
    netron2 = await Netron.create({
      id: 'n2',
    });
    peer = await netron2.connect('ws://localhost:8080');
    peer2 = netron.peers.get(netron2.id)!;
  });

  afterEach(async () => {
    await netron2.disconnect(peer.id);
    await netron.stop();
  });

  it('should receive data through read()', async () => {
    // const writableStream = peer.createWritableStream();
    // const readableStream = peer2.createReadableStream();
    // writableStream.write("Hello, world!");
    // expect(await readableStream.read()).toBe("Hello, world!");
  });
});
