import { ListBuffer } from '../src/utils/list-buffer';

describe('ListBuffer', () => {
  let buffer: ListBuffer<number>;

  beforeEach(() => {
    buffer = new ListBuffer<number>();
  });

  it('should initialize with length 0', () => {
    expect(buffer.length).toBe(0);
  });

  it('should add elements to the end of the list', () => {
    buffer.push(1);
    buffer.push(2);
    expect(buffer.length).toBe(2);
  });

  it('should remove and return the first element from the list', () => {
    buffer.push(1);
    buffer.push(2);
    const value = buffer.shift();
    expect(value).toBe(1);
    expect(buffer.length).toBe(1);
  });

  it('should return undefined when removing from an empty list', () => {
    const value = buffer.shift();
    expect(value).toBeUndefined();
    expect(buffer.length).toBe(0);
  });

  it('should handle multiple push and shift operations', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(buffer.shift()).toBe(1);
    expect(buffer.shift()).toBe(2);
    expect(buffer.shift()).toBe(3);
    expect(buffer.shift()).toBeUndefined();
    expect(buffer.length).toBe(0);
  });

  it('should maintain correct order of elements', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(buffer.shift()).toBe(1);
    buffer.push(4);
    expect(buffer.shift()).toBe(2);
    expect(buffer.shift()).toBe(3);
    expect(buffer.shift()).toBe(4);
    expect(buffer.length).toBe(0);
  });

  it('should correctly update head and tail references', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.shift();
    buffer.push(3);
    expect(buffer.shift()).toBe(2);
    expect(buffer.shift()).toBe(3);
    expect(buffer.shift()).toBeUndefined();
    expect(buffer.length).toBe(0);
  });

  it('should allow reusing ListBuffer after clearing all elements', () => {
    buffer.push(1);
    buffer.push(2);
    buffer.shift();
    buffer.shift();
    buffer.push(3);
    expect(buffer.length).toBe(1);
    expect(buffer.shift()).toBe(3);
    expect(buffer.length).toBe(0);
  });
});
