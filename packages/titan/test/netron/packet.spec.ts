import { Packet, TYPE_GET, PacketType, TYPE_STREAM, createPacket, encodePacket, decodePacket } from '../../src/netron';

describe('Packet', () => {
  let pkt: Packet;

  beforeEach(() => {
    pkt = new Packet(1);
  });

  it('initialization', () => {
    expect(pkt.flags).toEqual(0);
    expect(pkt.id).toEqual(1);
    expect(pkt.data).toBeUndefined();
  });

  it('set/get impulse bit', () => {
    expect(pkt.getImpulse()).toEqual(0);
    pkt.setImpulse(1);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.flags).toEqual(0x40);
    pkt.setImpulse(0);
    expect(pkt.getImpulse()).toEqual(0);
  });

  it('set/get error bit', () => {
    expect(pkt.getError()).toEqual(0);
    pkt.setError(1);
    expect(pkt.getError()).toEqual(1);
    expect(pkt.flags).toEqual(0x80);
    pkt.setError(0);
    expect(pkt.getError()).toEqual(0);
  });

  it('set/get type value', () => {
    pkt.setImpulse(1);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getType()).toEqual(0);
    pkt.setType(0x34 as PacketType);
    expect(pkt.getType()).toEqual(4);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(0);
    pkt.setType(0x0f as PacketType);
    expect(pkt.getType()).toEqual(0x0f);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(0);
    pkt.setError(1);
    pkt.setType(0 as PacketType);
    expect(pkt.getType()).toEqual(0);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(1);
  });

  it('create packet from values', () => {
    const id = 64;
    const impulse = 1;
    const action = TYPE_GET;
    const data = {
      some: 'data',
      luck: 777,
    };

    const pkt = createPacket(id, impulse, action, data);

    expect(pkt.getImpulse()).toEqual(impulse);
    expect(pkt.getType()).toEqual(action);
    expect(pkt.id).toEqual(id);
    expect(pkt.data).toEqual(data);
  });

  it('encode/decode packet', () => {
    const pkt = createPacket(1, 1, 0x20 as PacketType, [1, 2, 3]);
    const decPkt = decodePacket(encodePacket(pkt));
    expect(pkt).toEqual(decPkt);
  });

  it('set/get flags independently', () => {
    pkt.setImpulse(1);
    pkt.setError(1);
    pkt.setType(0x0f as PacketType);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(1);
    expect(pkt.getType()).toEqual(0x0f);
    expect(pkt.flags).toEqual(0b11001111);
  });

  it('reset all flags', () => {
    pkt.setImpulse(1);
    pkt.setError(1);
    pkt.setType(0x3f as PacketType);
    pkt.setImpulse(0);
    pkt.setError(0);
    pkt.setType(0 as PacketType);
    expect(pkt.getImpulse()).toEqual(0);
    expect(pkt.getError()).toEqual(0);
    expect(pkt.getType()).toEqual(0);
    expect(pkt.flags).toEqual(0x00);
  });

  it('encode/decode packet with complex data', () => {
    const complexData = { key: 'value', array: [1, 2, 3], nested: { a: 1 } };
    const pkt = createPacket(2, 0, 0x10 as PacketType, complexData);
    const decPkt = decodePacket(encodePacket(pkt));
    expect(pkt).toEqual(decPkt);
  });

  it('encode/decode packet with undefined data', () => {
    const pkt = createPacket(1, 0, 0x10 as PacketType, undefined);
    const encoded = encodePacket(pkt);
    const decoded = decodePacket(encoded);
    expect(decoded.data).toBeUndefined();
  });

  it('encode/decode packet with null data', () => {
    const pkt = createPacket(1, 0, 0x10 as PacketType, null);
    const encoded = encodePacket(pkt);
    const decoded = decodePacket(encoded);
    expect(decoded.data).toBeNull();
  });

  it('set/get stream info', () => {
    pkt.setStreamInfo(123, 0, true, false);
    expect(pkt.streamId).toEqual(123);
    expect(pkt.streamIndex).toEqual(0);
    expect(pkt.isLastChunk()).toBeTruthy();
    expect(pkt.isLive()).toBeFalsy();
  });

  it('check if packet is stream chunk', () => {
    pkt.setType(TYPE_STREAM);
    expect(pkt.isStreamChunk()).toBeTruthy();
    pkt.setType(TYPE_GET);
    expect(pkt.isStreamChunk()).toBeFalsy();
  });
});
