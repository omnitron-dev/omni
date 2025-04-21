import os from 'os';

/**
 * Generates a default consumer group name from a pattern.
 * @param {string} pattern - Channel pattern
 * @returns {string} Default group name
 */
export function defaultGroupName(pattern: string): string {
  return `grp:${pattern}`;
}

/**
 * Generates a default consumer name.
 * Uses hostname, process ID, and a random number for uniqueness.
 * @returns {string} Default consumer name
 */
export function defaultConsumerName(): string {
  return `${os.hostname()}:${process.pid}:${Math.floor(Math.random() * 10000)}`;
}

/**
 * Interface for custom name generator functions.
 * @interface GroupConsumerNameGenerators
 */
export interface GroupConsumerNameGenerators {
  /**
   * Custom function to generate group names.
   * @param {string} pattern - Channel pattern
   * @returns {string} Group name
   */
  groupNameFn?: (pattern: string) => string;

  /**
   * Custom function to generate consumer names.
   * @returns {string} Consumer name
   */
  consumerNameFn?: () => string;
}