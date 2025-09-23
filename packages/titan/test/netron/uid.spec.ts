import { Uid, MAX_UID_VALUE } from '../../src/netron';

describe('Uid', () => {
  it('max uid should be 4294967295 (max of uint32)', () => {
    expect(MAX_UID_VALUE).toBe(4294967295);
  });

  it('should generate unique ids', () => {
    const uid = new Uid();
    const id1 = uid.next();
    const id2 = uid.next();

    expect(id1).not.toBe(id2);
  });

  it('should reset to 1 after max integer', () => {
    const uid = new Uid(MAX_UID_VALUE - 1);
    const id0 = uid.next();
    const id1 = uid.next();
    const id2 = uid.next();

    expect(id0).toBe(MAX_UID_VALUE);
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });
});
